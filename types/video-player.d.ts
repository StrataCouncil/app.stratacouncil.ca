import type { DetailedHTMLProps, HTMLAttributes } from "react";

/* The Zoom Video SDK's container element: cameras are drawn inside it (components/meetings/VideoPanel.tsx). */
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "video-player-container": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;
    }
  }
}
