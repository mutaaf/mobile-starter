import { render, screen } from '@testing-library/react-native';

import HomeScreen from '@/app/index';

describe('HomeScreen', () => {
  it('renders the welcome heading', async () => {
    await render(<HomeScreen />);
    // The title separates "to" and "Expo" with a non-breaking space.
    expect(screen.getByText(/Welcome to\sExpo/)).toBeOnTheScreen();
  });

  it('shows the three getting-started hints', async () => {
    await render(<HomeScreen />);
    expect(screen.getByText('Try editing')).toBeOnTheScreen();
    expect(screen.getByText('Dev tools')).toBeOnTheScreen();
    expect(screen.getByText('Fresh start')).toBeOnTheScreen();
  });
});
