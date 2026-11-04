import { useCallback, useEffect, useState } from 'react';
import { api } from './services/api';

export function useResource<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(x => x + 1), []);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setData(null);
    if (!path) { setLoading(false); return; }
    api<T>(path).then(value => { if (active) setData(value); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [path, revision]);
  return { data, error, loading, refresh, setData };
}
