import { render, screen } from '../test-utils';

import ExploreScreen from '@/app/explore';

describe('ExploreScreen', () => {
  it('renders the heading and intro copy', async () => {
    await render(<ExploreScreen />);
    expect(screen.getByText('Explore')).toBeOnTheScreen();
    expect(screen.getByText(/This starter app includes example/)).toBeOnTheScreen();
  });

  // Guards invariant 6 in AGENTS.md. The Maestro flow asserts this element by
  // testID because iOS folds the child SF Symbol's name into the accessibility
  // label. Removing the testID would only surface in E2E, which needs a booted
  // device — this keeps the contract enforced by `npm run verify`.
  it('keeps the testID the E2E flow depends on', async () => {
    await render(<ExploreScreen />);
    expect(screen.getByTestId('explore-docs-link')).toBeOnTheScreen();
  });

  it('lists the collapsible feature sections', async () => {
    await render(<ExploreScreen />);
    for (const section of [
      'File-based routing',
      'Android, iOS, and web support',
      'Images',
      'Light and dark mode components',
      'Animations',
    ]) {
      expect(screen.getByText(section)).toBeOnTheScreen();
    }
  });
});
