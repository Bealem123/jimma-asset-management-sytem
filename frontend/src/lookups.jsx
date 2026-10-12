import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from './api.js';

const LookupContext = createContext(null);
export const useLookups = () => useContext(LookupContext);

/** Master data and enumerations, loaded once after sign-in and shared by every form. */
export function LookupProvider({ children }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      const [master, enums] = await Promise.all([api.get('/master/lookups'), api.get('/enums')]);
      setData({ master, enums });
      setError('');
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const value = useMemo(() => {
    if (!data) return { ready: false, error, refresh };
    const { master, enums } = data;
    const active = (rows) => rows.filter((r) => r.is_active);
    return {
      ready: true, error, refresh, enums, master,
      kifle: master['kifle-ketemas'],
      kebeles: master.kebeles,
      sectors: master.sectors,
      departments: master.departments,
      categories: master['asset-categories'],
      types: master['asset-types'],
      activeOnly: active,
    };
  }, [data, error, refresh]);

  return <LookupContext.Provider value={value}>{children}</LookupContext.Provider>;
}
