import type { AppData } from '../types';
import { deserialize, isEncryptedFile } from './storage';
import { validateReferentialIntegrity } from './integrity';

export type WorkingCopyLoadResult =
  | { type: 'empty' }
  | { type: 'encrypted'; text: string }
  | { type: 'ok'; data: AppData; warnings: string[] }
  | { type: 'corrupt'; error: string };

/** Pure init resolver for working-copy text — used by store.init and unit tests. */
export async function resolveWorkingCopyLoad(workingText: string | undefined): Promise<WorkingCopyLoadResult> {
  if (!workingText) return { type: 'empty' };

  if (isEncryptedFile(workingText)) {
    return { type: 'encrypted', text: workingText };
  }

  try {
    const data = await deserialize(workingText);
    const warnings = validateReferentialIntegrity(data);
    return { type: 'ok', data, warnings };
  } catch (err) {
    return { type: 'corrupt', error: (err as Error).message || 'Could not read saved data.' };
  }
}
