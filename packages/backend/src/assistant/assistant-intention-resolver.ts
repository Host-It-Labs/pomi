import { normalizeOptionalString } from './assistant-input-utils';
import { AssistantCaptureIntention } from './assistant-input-types';

type TaskIntentionResolution = {
  intentionSlug?: string | null;
  subIntentionSlug?: string | null;
};

// Voice transcription commonly changes one or two characters in short names.
// Keep the threshold conservative while the margin check rejects ambiguity.
const FUZZY_MATCH_THRESHOLD = 0.76;
const FUZZY_MATCH_MARGIN = 0.08;

export class AssistantIntentionResolver {
  resolve(
    value: Record<string, unknown>,
    sourceText: string,
    intentions: AssistantCaptureIntention[],
    resolutionNotes: string[]
  ): TaskIntentionResolution {
    const requestedParent = this.findBySlug(value.intentionSlug, intentions);
    const requestedChild = this.findBySlug(value.subIntentionSlug, intentions);
    const intentionMention = normalizeOptionalString(value.intentionMention);
    const explicitPhrases = this.explicitIntentionPhrases(sourceText);
    const explicitMatch =
      explicitPhrases.length > 0
        ? this.findExplicitMatch(explicitPhrases, intentions)
        : null;

    const requested = requestedChild ?? requestedParent;
    if (explicitPhrases.length > 0) {
      if (explicitMatch) {
        return this.resolveMatchedIntention(
          explicitMatch,
          requestedChild,
          sourceText,
          intentions,
          resolutionNotes
        );
      }
      // Keep a valid model slug when the transcript only contains an
      // unrecognized ASR phrase (for example "groceries intention" for the
      // supplied `cooking-groceries` slug).
      if (requested)
        return this.preserveRequested(
          requestedParent,
          requestedChild,
          sourceText,
          intentions,
          resolutionNotes
        );
      const mentionedMatch = intentionMention
        ? this.findConfidentMatch([intentionMention], intentions, 'literal')
        : null;
      if (mentionedMatch) {
        return this.resolveMatchedIntention(
          mentionedMatch,
          requestedChild,
          sourceText,
          intentions,
          resolutionNotes
        );
      }
      resolutionNotes.push('No unique existing intention matched request.');
      return { intentionSlug: null, subIntentionSlug: null };
    }

    const mentionedMatch = intentionMention
      ? this.findConfidentMatch([intentionMention], intentions, 'literal')
      : null;
    if (intentionMention && mentionedMatch) {
      return this.resolveMatchedIntention(
        mentionedMatch,
        requestedChild,
        sourceText,
        intentions,
        resolutionNotes
      );
    }
    if (intentionMention && requested) {
      return this.preserveRequested(
        requestedParent,
        requestedChild,
        sourceText,
        intentions,
        resolutionNotes
      );
    }

    const sourceMatch = this.findConfidentMatch(
      [sourceText],
      intentions,
      'phrases'
    );

    if (sourceMatch && !requested) {
      return this.resolveMatchedIntention(
        sourceMatch,
        requestedChild,
        sourceText,
        intentions,
        resolutionNotes
      );
    }

    if (requested)
      return this.preserveRequested(
        requestedParent,
        requestedChild,
        sourceText,
        intentions,
        resolutionNotes
      );
    if (value.intentionSlug) {
      resolutionNotes.push('No unique existing intention matched request.');
      return { intentionSlug: null, subIntentionSlug: null };
    }
    return {};
  }

  private preserveRequested(
    requestedParent: AssistantCaptureIntention | null,
    requestedChild: AssistantCaptureIntention | null,
    sourceText: string,
    intentions: AssistantCaptureIntention[],
    resolutionNotes: string[]
  ): TaskIntentionResolution {
    if (requestedChild?.parentSlug) {
      return {
        intentionSlug: requestedChild.parentSlug,
        subIntentionSlug: requestedChild.slug,
      };
    }
    if (requestedParent?.parentSlug) {
      return {
        intentionSlug: requestedParent.parentSlug,
        subIntentionSlug: requestedParent.slug,
      };
    }
    if (
      requestedParent &&
      intentions.some(
        intention => intention.parentSlug === requestedParent.slug
      )
    ) {
      return this.resolveParentSelection(
        requestedParent,
        null,
        sourceText,
        intentions,
        resolutionNotes
      );
    }
    if (requestedParent) return { intentionSlug: requestedParent.slug };
    return {};
  }

  private resolveMatchedIntention(
    match: AssistantCaptureIntention,
    requestedChild: AssistantCaptureIntention | null,
    sourceText: string,
    intentions: AssistantCaptureIntention[],
    resolutionNotes: string[]
  ) {
    if (match.parentSlug) {
      return {
        intentionSlug: match.parentSlug,
        subIntentionSlug: match.slug,
      };
    }
    return this.resolveParentSelection(
      match,
      requestedChild,
      sourceText,
      intentions,
      resolutionNotes
    );
  }

  private resolveParentSelection(
    parent: AssistantCaptureIntention,
    requestedChild: AssistantCaptureIntention | null,
    sourceText: string,
    intentions: AssistantCaptureIntention[],
    resolutionNotes: string[]
  ): TaskIntentionResolution {
    const children = intentions.filter(
      intention => intention.parentSlug === parent.slug
    );
    if (children.length === 0) {
      return { intentionSlug: parent.slug };
    }
    if (requestedChild?.parentSlug === parent.slug) {
      return {
        intentionSlug: parent.slug,
        subIntentionSlug: requestedChild.slug,
      };
    }

    const childMatch = this.findConfidentMatch(
      [
        sourceText.replace(
          new RegExp(this.escapeRegExp(parent.title), 'ig'),
          ''
        ),
      ],
      children,
      'phrases'
    );
    if (childMatch) {
      return {
        intentionSlug: parent.slug,
        subIntentionSlug: childMatch.slug,
      };
    }

    resolutionNotes.push(
      `Parent intention ${parent.title} requires a uniquely matched Sub-intention.`
    );
    return { intentionSlug: null, subIntentionSlug: null };
  }

  private findConfidentMatch(
    sources: string[],
    intentions: AssistantCaptureIntention[],
    sourceMode: 'phrases' | 'literal'
  ) {
    const normalizedSources = (
      sourceMode === 'phrases'
        ? sources.flatMap(source => this.intentionPhrases(source))
        : sources.map(source => this.normalizeMatchText(source))
    ).filter(Boolean);
    const scored = intentions
      .map(intention => {
        const names = [intention.title, intention.slug].map(name =>
          this.normalizeMatchText(name)
        );
        const score = Math.max(
          ...normalizedSources.flatMap(source =>
            names.map(name => {
              if (source === name) return 1;
              // A transcript often keeps only one meaningful word from a
              // compound Intention title ("groceries" -> "Cooking -
              // Groceries"). Treat a full token phrase as a confident match;
              // the runner-up margin still protects ambiguous vocabularies.
              if (
                (name.includes(` ${source} `) ||
                  name.startsWith(`${source} `) ||
                  name.endsWith(` ${source}`)) &&
                source.length >= 3
              ) {
                return 0.9;
              }
              if (name.length < 3 || source.length < 3) return 0;
              return this.similarity(source, name);
            })
          )
        );
        return { intention, score };
      })
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    const runnerUp = scored[1];
    if (!best || best.score < FUZZY_MATCH_THRESHOLD) return null;
    if (runnerUp && best.score - runnerUp.score < FUZZY_MATCH_MARGIN) {
      return null;
    }
    return best.intention;
  }

  private matchesExplicitPhrase(
    intention: AssistantCaptureIntention,
    explicitPhrases: string[]
  ) {
    return (
      this.findConfidentMatch(explicitPhrases, [intention], 'literal')?.slug ===
      intention.slug
    );
  }

  private findExplicitMatch(
    explicitPhrases: string[],
    intentions: AssistantCaptureIntention[]
  ) {
    const phrases = new Set(
      explicitPhrases.map(phrase => this.normalizeMatchText(phrase))
    );
    const exactMatches = intentions
      .flatMap(intention =>
        [intention.title, intention.slug].map(name => ({
          intention,
          name: this.normalizeMatchText(name),
        }))
      )
      .filter(candidate => phrases.has(candidate.name))
      .sort((left, right) => right.name.length - left.name.length);
    const best = exactMatches[0];
    const runnerUp = exactMatches.find(
      candidate => candidate.intention.slug !== best?.intention.slug
    );
    if (best && (!runnerUp || best.name.length > runnerUp.name.length)) {
      return best.intention;
    }
    return this.findConfidentMatch(explicitPhrases, intentions, 'literal');
  }

  private intentionPhrases(source: string) {
    const normalized = this.normalizeMatchText(source);
    const tokens = normalized.split(' ').filter(Boolean);
    const phrases = new Set<string>([normalized]);
    for (let size = 1; size <= Math.min(4, tokens.length); size += 1) {
      for (let index = 0; index <= tokens.length - size; index += 1) {
        phrases.add(tokens.slice(index, index + size).join(' '));
      }
    }
    const intentionIndex = tokens.indexOf('intention');
    if (intentionIndex >= 0) {
      for (let size = 1; size <= 4; size += 1) {
        phrases.add(
          tokens.slice(intentionIndex + 1, intentionIndex + 1 + size).join(' ')
        );
        phrases.add(
          tokens
            .slice(Math.max(0, intentionIndex - size), intentionIndex)
            .join(' ')
        );
      }
    }
    phrases.delete('');
    phrases.delete('intention');
    return Array.from(phrases);
  }

  private explicitIntentionPhrases(source: string) {
    const normalized = this.normalizeMatchText(source);
    const tokens = normalized.split(' ').filter(Boolean);
    const phrases = new Set<string>();
    for (let index = 0; index < tokens.length; index += 1) {
      if (tokens[index] !== 'intention') continue;
      for (let size = 1; size <= 4; size += 1) {
        phrases.add(tokens.slice(index + 1, index + 1 + size).join(' '));
        phrases.add(tokens.slice(Math.max(0, index - size), index).join(' '));
      }
    }
    phrases.delete('');
    return Array.from(phrases);
  }

  private findBySlug(value: unknown, intentions: AssistantCaptureIntention[]) {
    const slug = normalizeOptionalString(value);
    return slug
      ? (intentions.find(intention => intention.slug === slug) ?? null)
      : null;
  }

  private normalizeMatchText(value: string) {
    return value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  private similarity(left: string, right: string) {
    const distance = this.levenshtein(left, right);
    return 1 - distance / Math.max(left.length, right.length, 1);
  }

  private levenshtein(left: string, right: string) {
    const previous = Array.from(
      { length: right.length + 1 },
      (_, index) => index
    );
    for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
      const current = [leftIndex];
      for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
        const substitution =
          previous[rightIndex - 1] +
          (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
        current[rightIndex] = Math.min(
          current[rightIndex - 1] + 1,
          previous[rightIndex] + 1,
          substitution
        );
      }
      previous.splice(0, previous.length, ...current);
    }
    return previous[right.length];
  }

  private escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
