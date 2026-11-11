import { ChoiceSelect, type ChoiceOption } from '../components/ChoiceSelect';
import { useLocale } from '../i18n';
import { modelCopy } from './model-copy';
import { MotionDetails } from '../motion/Presence';
import './model-settings.css';

/** Glide Select's compact row hierarchy; existing keyboard, placement and value semantics. */
export function ModelChoice({
  label,
  ariaLabel,
  value,
  onChange,
  options,
  disabled,
  placeholder,
}: {
  label: string;
  ariaLabel?: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly ChoiceOption[];
  disabled?: boolean;
  placeholder?: string;
}) {
  const c = modelCopy(useLocale());
  return (
    <div className="ai-model-field">
      <ChoiceSelect
        className="ai-model-choice"
        label={label}
        ariaLabel={ariaLabel}
        value={value}
        onValueChange={onChange}
        options={options}
        disabled={disabled}
        placeholder={placeholder}
      />
      {value && (
        <MotionDetails className="ai-model-identity">
          <summary>{c.modelId}</summary>
          <code className="ai-model-identifier" aria-label={c.modelId}>
            {value}
          </code>
        </MotionDetails>
      )}
    </div>
  );
}
