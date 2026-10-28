/** A layered OBSIDIAN HALL surface. */
// eslint-disable-next-line react/prop-types
const Panel = ({ as: Tag = "section", flush = false, className = "", children, ...rest }) => (
  <Tag className={`oh-panel ${flush ? "oh-panel--flush" : ""} ${className}`} {...rest}>
    {children}
  </Tag>
);

export default Panel;
