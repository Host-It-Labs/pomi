#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

export const DEFAULT_POLL_INTERVAL_MS = 60_000;
export const DEFAULT_TIMEOUT_MS = 1_800_000;
export const REVIEW_DISPOSITION_MARKER = 'pomi-review-disposition:v1';

const PASSING_CHECK_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const COMPLETED_PR_STATES = new Set(['OPEN', 'CLOSED', 'MERGED']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function authorLogin(value) {
  return String(value?.author?.login ?? value?.user?.login ?? '')
    .trim()
    .toLowerCase();
}

export function isCodexReviewAuthor(login) {
  const normalized = String(login ?? '')
    .trim()
    .toLowerCase();
  return (
    normalized === 'chatgpt-codex-connector' ||
    normalized === 'chatgpt-codex-connector[bot]'
  );
}

export function hasExplicitReviewDisposition(comment) {
  const match = String(comment?.body ?? '').match(
    /<!--\s*pomi-review-disposition:v1\s+(\{[^]*?\})\s*-->/
  );
  if (!match) return false;
  try {
    const disposition = JSON.parse(match[1]);
    return (
      disposition.version === 1 &&
      disposition.outcome === 'contradicts-request' &&
      disposition.requiresUserCheck === true
    );
  } catch {
    return false;
  }
}

function reviewThreadComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return array(thread?.comments?.nodes);
}

export function unprocessedReviewThreads(threads) {
  return array(threads).filter(thread => {
    if (thread?.isResolved === true) return false;
    return !reviewThreadComments(thread).some(comment =>
      hasExplicitReviewDisposition(comment)
    );
  });
}

export function flattenReactionPages(pages) {
  return array(pages).flatMap(page => array(page));
}

function checkName(check, index) {
  return String(check?.name || check?.context || `check ${index + 1}`);
}

export function classifyCiChecks(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return {
      status: 'pending',
      problems: ['No CI checks have been reported for the pull request yet.'],
    };
  }

  const pending = [];
  const failed = [];
  checks.forEach((check, index) => {
    const name = checkName(check, index);
    const status = String(check?.status ?? '').toUpperCase();
    const conclusion = String(check?.conclusion ?? '').toUpperCase();
    const state = String(check?.state ?? '').toUpperCase();
    if (!status && state) {
      if (state === 'SUCCESS') return;
      if (state === 'PENDING' || state === 'EXPECTED') {
        pending.push(`${name} is not completed (${state}).`);
      } else {
        failed.push(`${name} is not green (${state}).`);
      }
    } else if (status !== 'COMPLETED') {
      pending.push(`${name} is not completed (${status || 'unknown'}).`);
    } else if (!PASSING_CHECK_CONCLUSIONS.has(conclusion)) {
      failed.push(`${name} is not green (${conclusion || 'unknown'}).`);
    }
  });
  if (failed.length) return { status: 'action-required', problems: failed };
  if (pending.length) return { status: 'pending', problems: pending };
  return { status: 'ready', problems: [] };
}

export async function classifyCodexReview({
  reviews,
  reactions,
  head,
  isAncestor,
}) {
  const codexReviews = array(reviews).filter(
    review =>
      isCodexReviewAuthor(authorLogin(review)) &&
      String(review?.state ?? '').toUpperCase() !== 'DISMISSED'
  );
  for (const review of codexReviews.toReversed()) {
    const reviewedCommit = String(review?.commit?.oid ?? '').trim();
    if (reviewedCommit && (await isAncestor(reviewedCommit, head))) {
      return { status: 'ready', problems: [] };
    }
  }

  const noFindingsReaction = array(reactions).some(
    reaction =>
      isCodexReviewAuthor(authorLogin(reaction)) &&
      String(reaction?.content ?? '').toLowerCase() === '+1'
  );
  if (noFindingsReaction) return { status: 'ready', problems: [] };
  if (codexReviews.length) {
    return {
      status: 'action-required',
      problems: [
        'The Codex review commit is not an ancestor of the current pull request head.',
      ],
    };
  }
  return {
    status: 'pending',
    problems: ['The automatic Codex review has not completed yet.'],
  };
}

export async function evaluatePullRequestReadiness({
  pullRequest,
  reviewThreads,
  reactions,
  localBranch,
  localHead,
  dirtyPaths = [],
  isAncestor,
}) {
  const structuralProblems = [];
  const state = String(pullRequest?.state ?? '').toUpperCase();
  const remoteHead = String(pullRequest?.headRefOid ?? '').toLowerCase();
  const currentHead = String(localHead ?? '').toLowerCase();

  if (!pullRequest)
    structuralProblems.push('Pull request details are missing.');
  else {
    if (!COMPLETED_PR_STATES.has(state)) {
      structuralProblems.push(
        `Pull request state is not supported (${state || 'unknown'}).`
      );
    }
    if (state === 'OPEN' && pullRequest.isDraft === true) {
      structuralProblems.push('Pull request is still a draft.');
    }
    if (String(pullRequest.headRefName ?? '') !== String(localBranch ?? '')) {
      structuralProblems.push(
        'The local branch does not match the pull request branch.'
      );
    }
    if (!remoteHead || remoteHead !== currentHead) {
      structuralProblems.push(
        'The local HEAD does not match the pull request HEAD.'
      );
    }
  }
  if (dirtyPaths.length) {
    structuralProblems.push(
      `The worktree has uncommitted changes (${dirtyPaths.length} path(s)).`
    );
  }
  if (structuralProblems.length) {
    return { status: 'action-required', problems: structuralProblems };
  }

  const unprocessed = unprocessedReviewThreads(reviewThreads);
  if (unprocessed.length) {
    return {
      status: 'action-required',
      problems: [
        `${unprocessed.length} review thread(s) still need resolution or an explicit ${REVIEW_DISPOSITION_MARKER} disposition.`,
      ],
    };
  }

  const ci = classifyCiChecks(pullRequest.statusCheckRollup);
  if (ci.status === 'action-required') return ci;

  const review = await classifyCodexReview({
    reviews: pullRequest.reviews,
    reactions,
    head: remoteHead,
    isAncestor,
  });
  if (review.status === 'action-required') return review;
  if (ci.status === 'pending' || review.status === 'pending') {
    return {
      status: 'pending',
      problems: [...ci.problems, ...review.problems],
    };
  }
  return { status: 'ready', problems: [] };
}

export async function waitForPullRequestReadiness({
  inspect,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  now = () => Date.now(),
  sleep = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds)),
  onPending = () => {},
}) {
  const startedAt = now();
  for (;;) {
    const result = await inspect();
    if (result.status !== 'pending') return result;
    const elapsed = now() - startedAt;
    if (elapsed >= timeoutMs) {
      return { status: 'timed-out', problems: result.problems };
    }
    onPending(result);
    await sleep(Math.min(pollIntervalMs, timeoutMs - elapsed));
  }
}

function run(command, args, cwd, { allowNonzero = false } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || (!allowNonzero && result.status !== 0)) {
    throw new Error(`${command} could not complete successfully.`);
  }
  return { output: String(result.stdout ?? '').trim(), status: 0 };
}

function parseJson(output, label) {
  try {
    return JSON.parse(output);
  } catch {
    throw new Error(`${label} did not return valid JSON.`);
  }
}

function dirtyPaths(root) {
  return run('git', ['status', '--porcelain=v1', '--untracked-files=all'], root)
    .output.split('\n')
    .filter(Boolean)
    .map(line => line.slice(3))
    .filter(path => path !== '.DS_Store' && !path.endsWith('/.DS_Store'));
}

function validateReviewPagination(reviewThreads) {
  if (!reviewThreads) throw new Error('GitHub review-thread data is missing.');
  if (reviewThreads.pageInfo?.hasNextPage) {
    throw new Error('The pull request has more than 100 review threads.');
  }
  if (
    array(reviewThreads.nodes).some(
      thread => thread?.comments?.pageInfo?.hasNextPage === true
    )
  ) {
    throw new Error('A review thread has more than 100 comments.');
  }
}

export function inspectLocalRepository(root = process.cwd()) {
  const branch = run('git', ['branch', '--show-current'], root).output;
  const head = run('git', ['rev-parse', 'HEAD'], root).output;
  if (!branch) throw new Error('The worktree is detached.');
  return { branch, head, dirtyPaths: dirtyPaths(root) };
}

export function createGitAncestorCheck(root = process.cwd()) {
  return async (ancestor, descendant) =>
    run('git', ['merge-base', '--is-ancestor', ancestor, descendant], root, {
      // A force-pushed, unrelated reviewed commit may no longer exist locally.
      // Either ordinary non-ancestry or a missing object means it is not valid.
      allowNonzero: true,
    }).status === 0;
}

export async function loadPullRequestSnapshot({
  root = process.cwd(),
  pullRequestNumber,
} = {}) {
  const local = inspectLocalRepository(root);
  const selector = pullRequestNumber ? [String(pullRequestNumber)] : [];
  const pullRequest = parseJson(
    run(
      'gh',
      [
        'pr',
        'view',
        ...selector,
        '--json',
        'number,state,isDraft,headRefName,headRefOid,statusCheckRollup,reviews,url',
      ],
      root
    ).output,
    'gh pr view'
  );
  const repository = run(
    'gh',
    ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
    root
  ).output;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GitHub repository identity is invalid.');
  }
  const [owner, repo] = repository.split('/');
  const query = `query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      pullRequest(number: $number) {
        reviewThreads(first: 100) {
          pageInfo { hasNextPage }
          nodes {
            isResolved
            comments(first: 100) {
              pageInfo { hasNextPage }
              nodes { author { login } body }
            }
          }
        }
      }
    }
  }`;
  const reviewResponse = parseJson(
    run(
      'gh',
      [
        'api',
        'graphql',
        '-f',
        `query=${query}`,
        '-F',
        `owner=${owner}`,
        '-F',
        `repo=${repo}`,
        '-F',
        `number=${pullRequest.number}`,
      ],
      root
    ).output,
    'GitHub review-thread query'
  );
  const reviewThreads =
    reviewResponse?.data?.repository?.pullRequest?.reviewThreads;
  validateReviewPagination(reviewThreads);
  const reactionPages = parseJson(
    run(
      'gh',
      [
        'api',
        `repos/${repository}/issues/${pullRequest.number}/reactions`,
        '--paginate',
        '--slurp',
      ],
      root
    ).output,
    'GitHub pull-request reactions query'
  );
  const reactions = flattenReactionPages(reactionPages);
  return { pullRequest, reviewThreads: reviewThreads.nodes, reactions, local };
}

export async function inspectPullRequestReadiness(options = {}) {
  const root = options.root ?? process.cwd();
  const snapshot = await loadPullRequestSnapshot({
    root,
    pullRequestNumber: options.pullRequestNumber,
  });
  const result = await evaluatePullRequestReadiness({
    pullRequest: snapshot.pullRequest,
    reviewThreads: snapshot.reviewThreads,
    reactions: snapshot.reactions,
    localBranch: snapshot.local.branch,
    localHead: snapshot.local.head,
    dirtyPaths: snapshot.local.dirtyPaths,
    isAncestor: createGitAncestorCheck(root),
  });
  return { ...result, pullRequest: snapshot.pullRequest };
}

function parseCliArguments(args) {
  const [command, ...options] = args;
  if (!['check', 'wait'].includes(command)) {
    throw new Error(
      'Usage: node scripts/pr-readiness.mjs check|wait [--pr number] [--timeout-seconds number]'
    );
  }
  let pullRequestNumber;
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  for (let index = 0; index < options.length; index += 1) {
    if (options[index] === '--pr' && options[index + 1]) {
      pullRequestNumber = Number(options[++index]);
      if (!Number.isSafeInteger(pullRequestNumber) || pullRequestNumber <= 0) {
        throw new Error('--pr must be a positive integer.');
      }
    } else if (options[index] === '--timeout-seconds' && options[index + 1]) {
      const seconds = Number(options[++index]);
      if (!Number.isFinite(seconds) || seconds < 0) {
        throw new Error('--timeout-seconds must be a non-negative number.');
      }
      timeoutMs = seconds * 1000;
    } else {
      throw new Error(`Unsupported PR readiness option: ${options[index]}`);
    }
  }
  return { command, pullRequestNumber, timeoutMs };
}

function reportResult(result) {
  const number = result.pullRequest?.number;
  const prefix = number ? `[pomi] PR #${number}` : '[pomi] Pull request';
  process.stdout.write(`${prefix} readiness: ${result.status}.\n`);
  for (const problem of result.problems ?? []) {
    process.stdout.write(`- ${problem}\n`);
  }
}

export async function runPrReadinessCli(args = process.argv.slice(2)) {
  const options = parseCliArguments(args);
  const inspect = () => inspectPullRequestReadiness(options);
  const result =
    options.command === 'wait'
      ? await waitForPullRequestReadiness({
          inspect,
          timeoutMs: options.timeoutMs,
          onPending: pending => reportResult(pending),
        })
      : await inspect();
  reportResult(result);
  if (result.status === 'ready') return 0;
  if (result.status === 'action-required') return 2;
  return 3;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runPrReadinessCli()
    .then(code => {
      process.exitCode = code;
    })
    .catch(error => {
      console.error(
        `[pomi] ${error instanceof Error ? error.message : String(error)}`
      );
      process.exitCode = 1;
    });
}
