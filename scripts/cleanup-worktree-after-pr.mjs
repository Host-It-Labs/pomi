#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CODEX_REVIEW_SUMMARY_MARKER =
  '<!-- codex-pull-request-review-summary -->';
const REQUIRED_AUTOMATIC_REVIEWS = ['Code Review', 'Security Review'];
const PASSING_CHECK_CONCLUSIONS = new Set(['SUCCESS', 'NEUTRAL', 'SKIPPED']);
const COMPLETED_PR_STATES = new Set(['OPEN', 'CLOSED', 'MERGED']);

function array(value) {
  return Array.isArray(value) ? value : [];
}

function reviewThreadComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return array(thread?.comments?.nodes);
}

function authorLogin(comment) {
  return String(comment?.author?.login ?? comment?.user?.login ?? '')
    .trim()
    .toLowerCase();
}

export function isAutomaticReviewAuthor(login) {
  const normalized = String(login ?? '')
    .trim()
    .toLowerCase();
  return (
    normalized === 'chatgpt-codex-connector' ||
    normalized === 'chatgpt-codex-connector[bot]' ||
    normalized === 'github-advanced-security' ||
    normalized === 'github-advanced-security[bot]' ||
    normalized.endsWith('[bot]')
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
}

export function automaticReviewSummaryProblems(comments) {
  const summaries = array(comments)
    .map(comment => String(comment?.body ?? ''))
    .filter(body => body.includes(CODEX_REVIEW_SUMMARY_MARKER));

  if (!summaries.length) {
    return ['Codex automatic review summary is missing.'];
  }

  const summary = summaries.at(-1);
  return REQUIRED_AUTOMATIC_REVIEWS.filter(reviewName => {
    const label = escapeRegExp(reviewName);
    return !new RegExp(
      '\\*\\*' + label + '\\*\\*\\s*\\|\\s*✅\\s*\\*\\*Completed\\*\\*',
      'i'
    ).test(summary);
  }).map(reviewName => reviewName + ' has not completed.');
}

export function unprocessedAutomaticReviewThreads(threads) {
  return array(threads).filter(thread => {
    const comments = reviewThreadComments(thread);
    const automaticCommentIndexes = comments
      .map((comment, index) =>
        isAutomaticReviewAuthor(authorLogin(comment)) ? index : -1
      )
      .filter(index => index >= 0);

    if (!automaticCommentIndexes.length || thread?.isResolved === true) {
      return false;
    }

    const lastAutomaticComment = Math.max(...automaticCommentIndexes);
    return !comments
      .slice(lastAutomaticComment + 1)
      .some(comment => !isAutomaticReviewAuthor(authorLogin(comment)));
  });
}

function checkName(check, index) {
  return String(check?.name || check?.context || 'check ' + (index + 1));
}

export function ciCheckProblems(checks) {
  if (!Array.isArray(checks) || checks.length === 0) {
    return ['No CI checks were reported for the pull request.'];
  }

  const problems = [];
  checks.forEach((check, index) => {
    const name = checkName(check, index);
    const status = String(check?.status ?? '').toUpperCase();
    const conclusion = String(
      check?.conclusion ?? check?.state ?? ''
    ).toUpperCase();

    if (status && status !== 'COMPLETED') {
      problems.push(name + ' is not completed (' + status + ').');
      return;
    }
    if (!PASSING_CHECK_CONCLUSIONS.has(conclusion)) {
      problems.push(
        name + ' is not green (' + (conclusion || 'unknown') + ').'
      );
    }
  });
  return problems;
}

export function pullRequestCompletionProblems({
  pullRequest,
  localBranch,
  localHead,
  comments,
  reviewThreads,
}) {
  if (!pullRequest) return ['Pull request details are missing.'];

  const problems = [];
  const state = String(pullRequest.state ?? '').toUpperCase();
  const remoteHead = String(pullRequest.headRefOid ?? '').toLowerCase();
  const currentHead = String(localHead ?? '').toLowerCase();

  if (!COMPLETED_PR_STATES.has(state)) {
    problems.push(
      'Pull request state is not complete (' + (state || 'unknown') + ').'
    );
  }
  if (state === 'OPEN' && pullRequest.isDraft === true) {
    problems.push('Pull request is still a draft.');
  }
  if (String(pullRequest.headRefName ?? '') !== String(localBranch ?? '')) {
    problems.push('The local branch does not match the pull request branch.');
  }
  if (!remoteHead || remoteHead !== currentHead) {
    problems.push('The local HEAD does not match the pull request HEAD.');
  }

  problems.push(...ciCheckProblems(pullRequest.statusCheckRollup));
  problems.push(...automaticReviewSummaryProblems(comments));

  const unprocessedThreads = unprocessedAutomaticReviewThreads(reviewThreads);
  if (unprocessedThreads.length) {
    problems.push(
      unprocessedThreads.length +
        ' automatic review thread(s) still need a resolution or human disposition.'
    );
  }
  return problems;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw new Error(command + ' could not complete successfully.');
  }
  return String(result.stdout ?? '').trim();
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    throw new Error(filePath + ' does not contain valid JSON.');
  }
}

export function verifyLocalPullRequestCompletion({
  root,
  branch,
  head,
  pullRequest,
  reviewThreads,
}) {
  const status = run(
    'git',
    ['status', '--porcelain=v1', '--untracked-files=all'],
    root
  );
  const dirty = status
    .split('\n')
    .filter(Boolean)
    .filter(line => {
      const filePath = line.slice(3);
      return filePath !== '.DS_Store' && !filePath.endsWith('/.DS_Store');
    });
  if (dirty.length) {
    return [
      'The worktree has uncommitted changes (' + dirty.length + ' path(s)).',
    ];
  }

  return pullRequestCompletionProblems({
    pullRequest,
    localBranch: branch,
    localHead: head,
    comments: pullRequest.comments,
    reviewThreads,
  });
}

function main() {
  const root = process.env.CODEX_WORKTREE_PATH || process.cwd();
  const branch = run('git', ['branch', '--show-current'], root);
  const head = run('git', ['rev-parse', 'HEAD'], root);
  if (!branch) {
    throw new Error('The worktree is detached; no PR branch is available.');
  }

  const [pullRequestPath, reviewThreadsPath] = process.argv.slice(2);
  if (!pullRequestPath || !reviewThreadsPath) {
    throw new Error(
      'The cleanup verifier requires pull-request and review-thread JSON files.'
    );
  }
  const pullRequest = readJsonFile(pullRequestPath);
  const reviewThreadsResponse = readJsonFile(reviewThreadsPath);
  const reviewThreads =
    reviewThreadsResponse?.data?.repository?.pullRequest?.reviewThreads;
  if (!reviewThreads) {
    throw new Error('GitHub review-thread data is missing.');
  }
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
  const problems = verifyLocalPullRequestCompletion({
    root,
    branch,
    head,
    pullRequest,
    reviewThreads,
  });

  if (problems.length) {
    throw new Error('PR completion gate failed:\n- ' + problems.join('\n- '));
  }

  process.stdout.write(
    '[pomi] PR #' +
      pullRequest.number +
      ' is complete: green CI and processed automatic reviews confirmed.\n'
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main();
  } catch (error) {
    console.error(
      '[pomi] ' + (error instanceof Error ? error.message : String(error))
    );
    process.exitCode = 1;
  }
}
