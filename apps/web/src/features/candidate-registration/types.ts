/**
 * Local types for the registration feature. `RegistrationFileType` is the
 * narrow slice of candidate_file_type a registrant may attach — deliberately
 * fewer options than an admin has, since a candidate has no business setting
 * e.g. an internal assessment report type.
 */
export const REGISTRATION_FILE_TYPES = [
  "cv",
  "photo",
  "work_sample",
] as const;

export type RegistrationFileType = (typeof REGISTRATION_FILE_TYPES)[number];

export const REGISTRATION_FILE_LABELS: Record<RegistrationFileType, string> = {
  cv: "CV / résumé",
  photo: "Profile photo",
  work_sample: "Work sample",
};

export const REGISTRATION_FILE_HINTS: Record<RegistrationFileType, string> = {
  cv: "PDF or Word document. This is the one we most need.",
  photo: "A clear headshot. JPEG, PNG, or WebP.",
  work_sample: "Optional. Anything that shows your work.",
};

export interface AttachedFile {
  fileId: string;
  fileType: RegistrationFileType;
  filename: string;
  sizeBytes: number;
}
