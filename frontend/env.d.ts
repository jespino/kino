/// <reference types="vite/client" />

declare module 'virtual:kino-player' {
  /** the HTML exporter's player script (see vite.config.ts) */
  const code: string;
  export default code;
}
