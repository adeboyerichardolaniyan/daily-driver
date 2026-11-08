import { Children, isValidElement, type ReactNode } from "react";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "./select";
/** Styled, keyboard-accessible selection with native option-shaped children. */
export function ChoiceSelect({
  value,
  onChange,
  children,
  ...props
}: {
  value: string;
  onChange: (event: { target: { value: string } }) => void;
  children: ReactNode;
  "aria-label"?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}) {
  const options = Children.toArray(children).filter(
    isValidElement<{ value: string; children?: ReactNode; disabled?: boolean }>,
  );
  return (
    <Select
      value={value || "__empty__"}
      onValueChange={(next) =>
        onChange({ target: { value: next === "__empty__" ? "" : next } })
      }
      disabled={props.disabled}
    >
      <SelectTrigger
        {...props}
        className={`choice-select ${props.className ?? ""}`}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="start"
        className="choice-select-menu"
      >
        {options.map((option) => (
          <SelectItem
            key={option.props.value || "__empty__"}
            value={option.props.value || "__empty__"}
            disabled={option.props.disabled}
          >
            {option.props.children ?? option.props.value}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
