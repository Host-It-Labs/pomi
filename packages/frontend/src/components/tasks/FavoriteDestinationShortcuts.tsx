import { useState } from 'react';
import { FaChevronLeft, FaChevronRight } from 'react-icons/fa';
import { useI18n } from '../../i18n';

type Destination = { value: string; title: string; emoji: string };
const DESTINATIONS_PER_PAGE = 4;

export function FavoriteDestinationShortcuts({
  destinations,
  selectedValue,
  onSelect,
}: {
  destinations: Destination[];
  selectedValue: string | null;
  onSelect: (value: string) => void;
}) {
  const { t } = useI18n();
  const [page, setPage] = useState(0);
  const capacity = DESTINATIONS_PER_PAGE;
  const needsPaging = destinations.length > capacity;
  const lastPage = Math.max(0, Math.ceil(destinations.length / capacity) - 1);
  const visiblePage = Math.min(page, lastPage);
  return (
    <div className="favorite-destinations" data-testid="favorite-destinations">
      {needsPaging ? (
        <button
          type="button"
          className="favorite-page-arrow"
          title={t('common.previousPage')}
          aria-label={t('common.previousPage')}
          disabled={visiblePage === 0}
          onClick={() => setPage(visiblePage - 1)}
        >
          <FaChevronLeft size={8} />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      {destinations
        .slice(visiblePage * capacity, (visiblePage + 1) * capacity)
        .map((destination, index) => (
          <button
            type="button"
            key={destination.value}
            style={{ gridColumn: index + 2 }}
            title={destination.title}
            aria-label={destination.title}
            aria-pressed={selectedValue === destination.value}
            onClick={() => onSelect(destination.value)}
          >
            {destination.emoji}
          </button>
        ))}
      {needsPaging ? (
        <button
          type="button"
          className="favorite-page-arrow favorite-next-page"
          title={t('common.nextPage')}
          aria-label={t('common.nextPage')}
          disabled={visiblePage === lastPage}
          onClick={() => setPage(visiblePage + 1)}
        >
          <FaChevronRight size={8} />
        </button>
      ) : (
        <span className="favorite-next-page" aria-hidden="true" />
      )}
    </div>
  );
}
