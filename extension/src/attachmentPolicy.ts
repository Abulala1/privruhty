export type AttachmentPreferences = { enabled: boolean; mode: 'auto' | 'review' };
export const defaultAttachmentPreferences: AttachmentPreferences = { enabled: true, mode: 'auto' };
export function attachmentPreferences(value: unknown): AttachmentPreferences {
  const input = value as Partial<AttachmentPreferences> | null;
  return { enabled: input?.enabled !== false, mode: input?.mode === 'review' ? 'review' : 'auto' };
}
export const maxAttachmentBytes = 1_000_000;
export const maxAttachments = 5;
