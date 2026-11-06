/* eslint-disable react/prop-types */
import { useNavigate } from "react-router-dom";

/** History-aware public back link with an in-site fallback for direct entry. */
export default function PublicBack({ to = "/", children = "← Back", className = "public-back" }) {
  const navigate = useNavigate();
  return <a className={className} href={to} onClick={(event) => {
    if (window.history.state?.idx > 0) {
      event.preventDefault();
      navigate(-1);
    }
  }}>{children}</a>;
}
