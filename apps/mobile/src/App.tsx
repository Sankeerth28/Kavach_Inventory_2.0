import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { NavProvider, type Route } from './lib/nav';
import { SessionProvider, useSession } from './lib/session';
import { ChangePasswordScreen, LoginScreen } from './screens/auth';
import { HomeScreen } from './screens/home';
import { InvoiceScreen } from './screens/invoice';
import { MaterialInScreen } from './screens/material-in';
import { MovementScreen } from './screens/movement';
import { QuickReceiveScreen } from './screens/quick-receive';
import { ReportScreen, ReportsScreen } from './screens/reports';
import { StockDetailScreen, StockScreen } from './screens/stock';
import { PostedScreen, TransactionsScreen } from './screens/transactions';
import { Banner, Button, Hero, Loading, styles } from './ui';

function RouteView({ route }: { route: Route }) {
  switch (route.name) {
    case 'home':
      return <HomeScreen />;
    case 'stock':
      return <StockScreen />;
    case 'stockDetail':
      return <StockDetailScreen materialId={route.materialId} />;
    case 'materialIn':
      return <MaterialInScreen />;
    case 'invoice':
      return <InvoiceScreen id={route.id} />;
    case 'quickReceive':
      return <QuickReceiveScreen />;
    case 'materialOut':
      return <MovementScreen kind="issue" materialId={route.materialId} />;
    case 'materialReturn':
      return <MovementScreen kind="return" />;
    case 'transactions':
      return <TransactionsScreen />;
    case 'reports':
      return <ReportsScreen />;
    case 'report':
      return <ReportScreen reportKey={route.key} />;
    case 'posted':
      return <PostedScreen posting={route.posting} title={route.title} />;
  }
}

function Root() {
  const session = useSession();
  if (session.status === 'loading') {
    return (
      <View style={styles.screen}>
        <Hero title="KAVACH" />
        <Loading text="Starting…" />
      </View>
    );
  }
  if (session.status === 'anonymous') return <LoginScreen />;
  if (session.me?.user.mustChangePassword) return <ChangePasswordScreen />;
  if (!session.membership) {
    return (
      <View style={styles.screen}>
        <Hero title="No project" />
        <View style={styles.body}>
          <Banner tone="warning">
            You are not a member of any project. Ask your Project Admin.
          </Banner>
          <Button label="Sign out" variant="secondary" onPress={() => void session.logout()} />
        </View>
      </View>
    );
  }
  // A new stack per project and store: no screen of one is left open over another.
  return (
    <NavProvider key={`${session.membership.projectId}:${session.store?.id ?? ''}`}>
      {(route) => <RouteView route={route} />}
    </NavProvider>
  );
}

export default function App() {
  return (
    <SessionProvider>
      <Root />
      <StatusBar style="light" />
    </SessionProvider>
  );
}
