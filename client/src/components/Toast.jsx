/* eslint-disable react/prop-types */
/**
 * The one floating status line used by both game screens. Purely a read-out:
 * text set by the screen, announced politely, never a control.
 */
const Toast = ({ message, top = 68 }) =>
  message ? (
    <div
      className="oh-toast"
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        top,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 40,
        padding: "10px 18px",
        maxWidth: "90vw",
        fontSize: 14,
        textAlign: "center",
      }}
    >
      {message}
    </div>
  ) : null;

export default Toast;
