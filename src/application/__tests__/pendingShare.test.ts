import { describe, expect, it } from 'vitest';
import { stashPendingShare, takePendingShare } from '../pendingShare';

describe('pendingShare', () => {
  it('hands a share over once, then forgets it', () => {
    const file = new File(['x'], 'letter.jpg', { type: 'image/jpeg' });
    const id = stashPendingShare({ files: [file], text: 'hello' });
    expect(takePendingShare(id)).toEqual({ files: [file], text: 'hello' });
    expect(takePendingShare(id)).toBeNull();
  });

  it('gives each share its own id, and nothing for one it was never given', () => {
    const a = stashPendingShare({ files: [], text: 'a' });
    const b = stashPendingShare({ files: [], text: 'b' });
    expect(a).not.toBe(b);
    expect(takePendingShare(b)?.text).toBe('b');
    expect(takePendingShare('app_unknown')).toBeNull();
    expect(takePendingShare(a)?.text).toBe('a');
  });
});
