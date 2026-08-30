import { BadRequestException, Injectable } from '@nestjs/common';
import { TIMER_TYPES } from '@pomi/shared';
import type { ListEntity } from '../lists/lists.entity';
import { ParsedTaskDraft } from './assistant-input-interpreter';
import { translateAssistant } from '../i18n/assistant-localization';

type ListRouteMatch = {
  listId: string;
  titleStart: number;
  titleTokenCount: number;
  end: number;
  lead: string;
  hasMarkerBeforeTitle: boolean;
};

const LIST_ROUTE_LEADS = [
  ['to'],
  ['in'],
  ['into'],
  ['on'],
  ['under'],
  ['within'],
  ['for'],
  ['with'],
  ['a'],
  ['ao'],
  ['aos'],
  ['à'],
  ['au'],
  ['aux'],
  ['dans'],
  ['sur'],
  ['pour'],
  ['en'],
  ['на'],
  ['в'],
  ['для'],
  ['у'],
  ['के', 'लिए'],
  ['में'],
  ['पर'],
  ['को'],
  ['para'],
  ['em'],
  ['no'],
  ['na'],
  ['nos'],
  ['nas'],
  ['di'],
  ['ke'],
  ['dalam'],
  ['untuk'],
  ['di', 'dalam'],
  ['إلى'],
  ['في'],
  ['على'],
  ['من', 'أجل'],
  ['إلى', 'قائمة'],
  ['في', 'قائمة'],
  ['إلى', 'القائمة'],
  ['في', 'القائمة'],
  ['إلى', 'لیست'],
  ['میں'],
] as const;

const LIST_ROUTE_ARTICLES = [
  'the',
  'la',
  'le',
  'les',
  'el',
  'los',
  'las',
  'a',
  'o',
  'os',
  'as',
  'der',
  'die',
  'das',
  'den',
  'de',
  'da',
  'do',
  'dos',
  'um',
  'uma',
  'my',
  'our',
  'your',
  'mon',
  'ma',
  'mes',
  'mi',
  'mis',
  '列表',
  '列表中的',
  'قائمة',
  'सूची',
  'তালিকা',
  'daftar',
  'فہرست',
] as const;

const LIST_ROUTE_NAMING_WORDS = [
  'called',
  'named',
  'nommee',
  'nomme',
  'nommée',
  'nommé',
  'llamada',
  'llamado',
] as const;

const LIST_ROUTE_MARKERS = [
  'list',
  'liste',
  'lista',
  'قائمة',
  'सूची',
  'তালিকা',
  'daftar',
  'فہرست',
  '列表',
  '列表中的',
] as const;

@Injectable()
export class AssistantListRoutingService {
  routeExplicitListItems(
    drafts: ParsedTaskDraft[],
    sourceText: string,
    lists: Array<Pick<ListEntity, 'id' | 'title'>>,
    language: string | null | undefined
  ): ParsedTaskDraft[] {
    const sourceTokens = this.normalizeRoutingText(sourceText)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (sourceTokens.length === 0) {
      return drafts;
    }

    if (lists.length === 0) {
      if (this.hasExplicitListDestination(sourceTokens)) {
        throw new BadRequestException(
          translateAssistant(language, 'listDestinationUnavailable')
        );
      }
      return drafts;
    }

    const matches = lists.flatMap(list =>
      this.findListRouteMatches(sourceTokens, list, drafts)
    );
    const strongestMatches = matches.filter(
      match =>
        !matches.some(
          other =>
            other.titleStart === match.titleStart &&
            other.titleTokenCount > match.titleTokenCount
        )
    );
    const matchedListIds = new Set(strongestMatches.map(match => match.listId));
    if (matchedListIds.size > 1) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationAmbiguous')
      );
    }
    if (matchedListIds.size === 0) {
      if (this.hasExplicitListDestination(sourceTokens)) {
        throw new BadRequestException(
          translateAssistant(language, 'listDestinationUnavailable')
        );
      }
      return drafts;
    }

    const [matchedListId] = matchedListIds;
    const existingListIds = new Set(
      drafts
        .map(draft => draft.listId)
        .filter((listId): listId is string => Boolean(listId))
    );
    if (
      existingListIds.size > 0 &&
      (existingListIds.size > 1 || !existingListIds.has(matchedListId))
    ) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationAmbiguous')
      );
    }

    const match = strongestMatches.find(
      candidate => candidate.listId === matchedListId
    );
    if (drafts.some(draft => this.hasUnsupportedListItemMetadata(draft))) {
      throw new BadRequestException(
        translateAssistant(language, 'listMetadataUnsupported')
      );
    }
    if (!match) return drafts;
    if (!this.isUsableListRouteMatch(match, sourceTokens, drafts)) {
      const containsTrailingTask =
        drafts.length > 1 &&
        drafts.some(draft =>
          this.draftAppearsAfterListTarget(draft, sourceTokens, match.end)
        );
      throw new BadRequestException(
        translateAssistant(
          language,
          containsTrailingTask
            ? 'listDestinationAmbiguous'
            : 'listMetadataUnsupported'
        )
      );
    }
    const matchedList = lists.find(list => list.id === match.listId);
    return drafts.map(draft => ({
      ...draft,
      title:
        match.lead === 'implicit-trailing-list' && matchedList
          ? this.stripTrailingListTitle(draft.title, matchedList.title)
          : draft.title,
      listId: match.listId,
    }));
  }

  routeSelectedListItems(
    drafts: ParsedTaskDraft[],
    sourceText: string,
    selectedListId: string,
    lists: Array<Pick<ListEntity, 'id' | 'title'>>,
    language: string | null | undefined
  ): ParsedTaskDraft[] {
    if (!lists.some(list => list.id === selectedListId)) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationUnavailable')
      );
    }
    if (drafts.length !== 1) {
      throw new BadRequestException(
        translateAssistant(language, 'listQuickAddSingleItem')
      );
    }

    const explicitlyRouted = this.routeExplicitListItems(
      drafts,
      sourceText,
      lists,
      language
    );
    const explicitListIds = new Set(
      explicitlyRouted
        .map(draft => draft.listId)
        .filter((listId): listId is string => Boolean(listId))
    );
    if (explicitListIds.size > 0 && !explicitListIds.has(selectedListId)) {
      throw new BadRequestException(
        translateAssistant(language, 'listDestinationAmbiguous')
      );
    }
    if (drafts.some(draft => this.hasUnsupportedListItemMetadata(draft))) {
      throw new BadRequestException(
        translateAssistant(language, 'listMetadataUnsupported')
      );
    }
    return drafts.map(draft => ({ ...draft, listId: selectedListId }));
  }

  private findListRouteMatches(
    sourceTokens: string[],
    list: Pick<ListEntity, 'id' | 'title'>,
    drafts: ParsedTaskDraft[]
  ): ListRouteMatch[] {
    const titleTokens = this.normalizeRoutingText(list.title)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (titleTokens.length === 0) return [];

    const matches: ListRouteMatch[] = [];
    for (
      let titleStart = 0;
      titleStart <= sourceTokens.length - titleTokens.length;
      titleStart += 1
    ) {
      if (!this.tokensMatch(sourceTokens, titleStart, titleTokens)) continue;

      const prefix = this.findListRoutePrefix(sourceTokens, titleStart);
      const isImplicitTrailingMatch =
        !prefix &&
        drafts.length > 0 &&
        titleStart > 0 &&
        titleStart + titleTokens.length === sourceTokens.length;
      if (!prefix && !isImplicitTrailingMatch) continue;

      const markerAfterTitle = this.listMarkerSuffixLength(
        sourceTokens.slice(titleStart + titleTokens.length)
      );
      const hasListMarker =
        Boolean(prefix?.hasMarkerBeforeTitle) || markerAfterTitle > 0;
      if (prefix?.lead === 'for' && !hasListMarker) continue;

      matches.push({
        listId: list.id,
        titleStart,
        titleTokenCount: titleTokens.length,
        end: titleStart + titleTokens.length + markerAfterTitle,
        lead: prefix?.lead ?? 'implicit-trailing-list',
        hasMarkerBeforeTitle: prefix?.hasMarkerBeforeTitle ?? false,
      });
    }
    return matches;
  }

  private stripTrailingListTitle(taskTitle: string, listTitle: string) {
    const taskParts = taskTitle.trim().split(/\s+/);
    const listTokenCount = this.normalizeRoutingText(listTitle)
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (taskParts.length <= listTokenCount) return taskTitle;

    const suffix = taskParts.slice(-listTokenCount).join(' ');
    if (
      this.normalizeRoutingText(suffix).trim() !==
      this.normalizeRoutingText(listTitle).trim()
    ) {
      return taskTitle;
    }
    return taskParts.slice(0, -listTokenCount).join(' ');
  }

  private findListRoutePrefix(sourceTokens: string[], titleStart: number) {
    for (const leadTokens of LIST_ROUTE_LEADS) {
      const articleVariants = [
        [],
        ...LIST_ROUTE_ARTICLES.map(article => [article]),
      ];
      const markerVariants = [
        [],
        ...LIST_ROUTE_MARKERS.map(marker => [marker]),
      ];
      for (const article of articleVariants) {
        for (const marker of markerVariants) {
          const namingVariants = marker.length
            ? [[], ...LIST_ROUTE_NAMING_WORDS.map(word => [word])]
            : [[]];
          for (const naming of namingVariants) {
            const prefixTokens = [
              ...leadTokens,
              ...article,
              ...marker,
              ...naming,
            ];
            const prefixStart = titleStart - prefixTokens.length;
            if (
              prefixStart < 0 ||
              !this.tokensMatch(sourceTokens, prefixStart, prefixTokens)
            ) {
              continue;
            }
            return {
              lead: leadTokens.join(' '),
              hasMarkerBeforeTitle: marker.length > 0,
            };
          }
        }
      }
    }
    return null;
  }

  private isUsableListRouteMatch(
    match: ListRouteMatch,
    sourceTokens: string[],
    drafts: ParsedTaskDraft[]
  ) {
    const trailingTokens = sourceTokens.slice(match.end);
    if (trailingTokens.length === 0) return true;

    if (
      drafts.length > 1 &&
      drafts.some(draft =>
        this.draftAppearsAfterListTarget(draft, sourceTokens, match.end)
      )
    ) {
      return false;
    }

    return this.looksLikeListMetadata(trailingTokens.join(' '));
  }

  private draftAppearsAfterListTarget(
    draft: ParsedTaskDraft,
    sourceTokens: string[],
    targetEnd: number
  ) {
    const evidence = draft.sourceTranscript?.trim() || draft.title;
    const evidenceTokens = this.normalizeRoutingText(evidence)
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (evidenceTokens.length === 0) return false;

    for (
      let index = targetEnd;
      index <= sourceTokens.length - evidenceTokens.length;
      index += 1
    ) {
      if (this.tokensMatch(sourceTokens, index, evidenceTokens)) return true;
    }
    return false;
  }

  private tokensMatch(
    sourceTokens: string[],
    start: number,
    expectedTokens: readonly string[]
  ) {
    return expectedTokens.every(
      (token, offset) => sourceTokens[start + offset] === token
    );
  }

  private isListRouteMarker(token: string | undefined) {
    return Boolean(
      token && LIST_ROUTE_MARKERS.some(marker => marker === token)
    );
  }

  private listMarkerSuffixLength(tokens: string[]) {
    if (this.isListRouteMarker(tokens[0])) return 1;
    if (
      tokens[0] === 'as' &&
      (tokens[1] === 'its' || tokens[1] === 'the') &&
      this.isListRouteMarker(tokens[2])
    ) {
      return 3;
    }
    return 0;
  }

  private looksLikeListMetadata(value: string) {
    let remaining = this.normalizeRoutingText(value).trim();
    if (!remaining) return true;

    const date =
      '(?:\\d{4} \\d{2} \\d{2}|today|tomorrow|tonight|yesterday|next week|next month|monday|tuesday|wednesday|thursday|friday|saturday|sunday|aujourd’hui|aujourd hui|demain|mañana|hoy|amanhã|hoje|besok|hari ini|明天|今天|कल|आज|غد|اليوم|আগামীকাল|আজ|کل|آج)';
    remaining = remaining
      .replace(
        new RegExp(
          `\\b(?:due date|due|on|by)\\s+(?:next\\s+)?${date}\\b`,
          'giu'
        ),
        ' '
      )
      .replace(new RegExp(`\\b${date}\\b`, 'giu'), ' ')
      .replace(
        /\b(?:priority\s+(?:is\s+)?(?:low|normal|high|urgent)|(?:low|normal|high|urgent)(?:\s+priority)?)\b/giu,
        ' '
      )
      .replace(
        /\b(?:vacation coverage|vacation eligible|holiday coverage|holiday eligible)\b/giu,
        ' '
      )
      .replace(/\b(?:and|also|please|with)\b/giu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return remaining.length === 0;
  }

  private hasExplicitListDestination(sourceTokens: string[]) {
    const routableLeads = LIST_ROUTE_LEADS.filter(
      leadTokens => leadTokens.join(' ') !== 'a'
    );
    return LIST_ROUTE_MARKERS.some(marker => {
      const markerTokens = this.normalizeRoutingText(marker)
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      for (
        let markerStart = 0;
        markerStart + markerTokens.length <= sourceTokens.length;
        markerStart += 1
      ) {
        if (!this.tokensMatch(sourceTokens, markerStart, markerTokens)) {
          continue;
        }
        for (const leadTokens of routableLeads) {
          for (let start = 0; start < markerStart; start += 1) {
            const leadEnd = start + leadTokens.length;
            if (
              leadEnd < markerStart &&
              this.tokensMatch(sourceTokens, start, leadTokens)
            ) {
              return true;
            }
            if (
              leadEnd === markerStart &&
              markerStart + markerTokens.length < sourceTokens.length
            ) {
              return true;
            }
          }
        }
      }
      return false;
    });
  }

  private hasUnsupportedListItemMetadata(draft: ParsedTaskDraft) {
    return Boolean(
      draft.description?.trim() ||
      draft.dueTime ||
      draft.recurrenceRule ||
      draft.recurrenceInterval ||
      (draft.timerType && draft.timerType !== TIMER_TYPES.WORK)
    );
  }

  private normalizeRoutingText(value: string) {
    return ` ${value
      .toLowerCase()
      .normalize('NFKC')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim()} `;
  }
}
