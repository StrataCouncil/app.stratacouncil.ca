/** What kind of news an announcement is (0031). Shown as its label. */
export const announcementCategories = {
  general: "News",
  feature: "New feature",
  change: "Change",
  training: "Training",
  library: "Library",
  legislation: "Legislation",
} as const;
export type AnnouncementCategory = keyof typeof announcementCategories;
export const isAnnouncementCategory = (v: unknown): v is AnnouncementCategory =>
  typeof v === "string" && Object.prototype.hasOwnProperty.call(announcementCategories, v);
