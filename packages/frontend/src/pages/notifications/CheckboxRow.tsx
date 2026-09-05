export const CheckboxRow = ({
  leftLabel,
  leftChecked,
  onLeftChange,
  rightLabel,
  rightChecked,
  onRightChange,
}: {
  leftLabel: string;
  leftChecked: boolean;
  onLeftChange: (value: boolean) => void;
  rightLabel: string;
  rightChecked: boolean;
  onRightChange: (value: boolean) => void;
}) => (
  <div className="flex w-full">
    <div className="flex items-center w-1/2 pr-2">
      <input
        type="checkbox"
        checked={leftChecked}
        onChange={e => onLeftChange(e.target.checked)}
        className="form-checkbox h-4 w-4 mr-2 cursor-pointer text-indigo-600 rounded focus:ring-indigo-500"
        id={`left-${leftLabel.replace(/\s/g, '')}`}
      />
      <label
        htmlFor={`left-${leftLabel.replace(/\s/g, '')}`}
        className="text-xs text-ink cursor-pointer"
      >
        {leftLabel}
      </label>
    </div>
    <div className="flex items-center w-1/2 pl-2">
      <input
        type="checkbox"
        checked={rightChecked}
        onChange={e => onRightChange(e.target.checked)}
        className="form-checkbox h-4 w-4 mr-2 cursor-pointer text-indigo-600 rounded focus:ring-indigo-500"
        id={`right-${rightLabel.replace(/\s/g, '')}`}
      />
      <label
        htmlFor={`right-${rightLabel.replace(/\s/g, '')}`}
        className="text-xs text-ink cursor-pointer"
      >
        {rightLabel}
      </label>
    </div>
  </div>
);
