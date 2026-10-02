/** A member's profile picture, or their initials when they haven't added one. */
export function MemberAvatar({ name, url }: { name: string; url: string | null }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" className="member-avatar" />;
  }
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  return (
    <span className="member-avatar member-avatar--initials" aria-hidden="true">
      {initials || "?"}
    </span>
  );
}
