import { createContext, useContext } from 'react';
import type { Profile } from '../types';
export type Session = { user: Profile | null; loading: boolean; reload: () => Promise<void> };
export const SessionContext = createContext<Session>({ user: null, loading: true, reload: async () => {} });
export const useSession = () => useContext(SessionContext);
