import { FaEdit, FaRegStar, FaStar } from 'react-icons/fa';
import { IconButton } from '../ui/IconButton';
import { useI18n } from '../../i18n';

function ManagerFavoriteButton({
  isFavorite,
  label,
  onClick,
}: {
  isFavorite: boolean;
  label: string;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <IconButton
      label={`${isFavorite ? t('intention.unfavorite') : t('intention.favorite')} ${label}`}
      title={isFavorite ? t('intention.unfavorite') : t('intention.favorite')}
      size="sm"
      variant={isFavorite ? 'primary' : 'secondary'}
      aria-pressed={isFavorite}
      onClick={onClick}
      className={
        isFavorite
          ? '!h-8 !w-8 !rounded-full !bg-amber-400/20 !p-0 !text-amber-300'
          : '!h-8 !w-8 !rounded-full !p-0'
      }
    >
      {isFavorite ? <FaStar /> : <FaRegStar />}
    </IconButton>
  );
}

export function ManagerRowActions({
  isFavorite,
  label,
  onFavorite,
  onEdit,
}: {
  isFavorite: boolean;
  label: string;
  onFavorite: () => void;
  onEdit: () => void;
}) {
  const { t } = useI18n();
  return (
    <div
      data-manager-controls="trailing"
      className="flex shrink-0 items-center gap-1"
    >
      <ManagerFavoriteButton
        isFavorite={isFavorite}
        label={label}
        onClick={onFavorite}
      />
      <IconButton
        label={`${t('common.edit')} ${label}`}
        title={t('common.edit')}
        size="sm"
        variant="secondary"
        onClick={onEdit}
        className="!h-8 !w-8 !rounded-full !p-0"
      >
        <FaEdit />
      </IconButton>
    </div>
  );
}
