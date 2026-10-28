/* eslint-disable react/prop-types */
/**
 * The one button in the system. `variant` maps to the hand-authored classes in
 * components.css; everything else (type, aria, handlers) passes straight
 * through so callers keep full control of semantics.
 */
const Button = ({
  variant = "gold",
  size = "md",
  block = false,
  className = "",
  as = "button",
  ...rest
}) => {
  const Tag = as;
  const classes = [
    "oh-btn",
    `oh-btn--${variant}`,
    size === "sm" ? "oh-btn--sm" : "",
    block ? "oh-btn--block" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  const props = Tag === "button" ? { type: "button", ...rest } : rest;
  return <Tag className={classes} {...props} />;
};

export default Button;
