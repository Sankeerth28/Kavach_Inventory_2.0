import { afterAll, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';
import App from './App';
import { queryClient } from './lib/session';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

afterAll(() => queryClient.clear());

it('shows the login screen when there is no stored session', async () => {
  await render(<App />);

  expect(await screen.findByText('Sign in to manage your store.')).toBeTruthy();
  expect(screen.getByLabelText('Mobile number or e-mail')).toBeTruthy();
  expect(screen.getByLabelText('Password')).toBeTruthy();
}, 60_000);
