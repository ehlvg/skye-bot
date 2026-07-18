import type { ReactNode } from "react";
import { Badge, Chevron } from "./ui";
import type { IconColor, IconType } from "./Icon";

export function Row({
  icon,
  color,
  title,
  subtitle,
  trailing,
  onClick,
  chevron = true,
  multiline = false,
  selected = false,
  className = "",
}: {
  icon?: IconType;
  color?: IconColor;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  multiline?: boolean;
  selected?: boolean;
  className?: string;
}) {
  const tap = !!onClick;
  return (
    <li
      className={`row${tap ? " row-tap" : ""}${selected ? " is-selected" : ""} ${className}`.trim()}
      onClick={onClick}
      role={tap ? "button" : undefined}
      tabIndex={tap ? 0 : undefined}
      onKeyDown={tap ? (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick?.();
        }
      } : undefined}
    >
      {icon && color && <Badge icon={icon} color={color} />}
      <div className="row-content">
        <div className={`row-title${multiline ? " row-title-multiline" : ""}`}>{title}</div>
        {subtitle && <div className="row-subtitle">{subtitle}</div>}
      </div>
      <div className="row-trailing">
        {trailing}
        {tap && chevron && !trailing && <Chevron />}
      </div>
    </li>
  );
}

export function List({ children }: { children: ReactNode }) {
  return <ul className="list glass">{children}</ul>;
}
