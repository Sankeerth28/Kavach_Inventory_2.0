import type { PostingDto, ReportKey } from '@kavach/shared';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { BackHandler } from 'react-native';

/**
 * A small stack navigator (PRD §21.5 "Simple navigation"). The app has a dozen screens and one
 * way through them, so a plain stack with the Android back button is all it needs.
 */
export type Route =
  | { name: 'home' }
  | { name: 'stock' }
  | { name: 'stockDetail'; materialId: string }
  | { name: 'materialIn' }
  | { name: 'invoice'; id: string }
  | { name: 'quickReceive' }
  | { name: 'materialOut'; materialId?: string }
  | { name: 'materialReturn' }
  | { name: 'transactions' }
  | { name: 'reports' }
  | { name: 'report'; key: ReportKey }
  | { name: 'posted'; posting: PostingDto; title: string };

interface Nav {
  route: Route;
  canGoBack: boolean;
  push: (route: Route) => void;
  /** Replaces the current screen: used after a posting, so "back" does not return to the form. */
  replace: (route: Route) => void;
  back: () => void;
  home: () => void;
}

const NavContext = createContext<Nav | null>(null);

export function NavProvider({ children }: { children: (route: Route) => ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: 'home' }]);

  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const nav = useMemo<Nav>(
    () => ({
      route: stack[stack.length - 1]!,
      canGoBack: stack.length > 1,
      push: (route) => setStack((s) => [...s, route]),
      replace: (route) => setStack((s) => [...s.slice(0, -1), route]),
      back,
      home: () => setStack([{ name: 'home' }]),
    }),
    [stack, back],
  );

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (stack.length <= 1) return false; // let the system leave the app
      back();
      return true;
    });
    return () => sub.remove();
  }, [stack.length, back]);

  return <NavContext.Provider value={nav}>{children(nav.route)}</NavContext.Provider>;
}

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside <NavProvider>');
  return nav;
}
