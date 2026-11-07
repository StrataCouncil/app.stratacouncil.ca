/**
 * A user's identity in the video session (Zoom allows 35 characters): their
 * id without its dashes, 32 characters. Shared by the token (server) and the
 * Runner's screen, which uses it to find someone who has stepped out.
 */
export function videoIdentity(userId: string): string {
  return userId.replace(/-/g, "").slice(0, 35);
}
