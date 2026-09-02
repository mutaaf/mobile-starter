import MotionScreen from '@/app/motion';

import { render, screen, waitFor } from '../test-utils';

// Simulators expose no accelerometer, and so does the Jest environment. This is
// the path most likely to regress into a frozen readout, so it is pinned here.
jest.mock('expo-sensors', () => ({
  Accelerometer: {
    isAvailableAsync: jest.fn(),
    setUpdateInterval: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  Gyroscope: {
    setUpdateInterval: jest.fn(),
    addListener: jest.fn(() => ({ remove: jest.fn() })),
  },
}));

const { Accelerometer } = jest.requireMock('expo-sensors');

describe('MotionScreen', () => {
  it('explains itself instead of showing dead readouts when no sensor exists', async () => {
    Accelerometer.isAvailableAsync.mockResolvedValue(false);

    await render(<MotionScreen />);

    await waitFor(() => expect(screen.getByTestId('motion-unavailable')).toBeOnTheScreen());
    expect(screen.queryByTestId('motion-level')).not.toBeOnTheScreen();
    expect(Accelerometer.addListener).not.toHaveBeenCalled();
  });

  it('subscribes and shows the level when a sensor is present', async () => {
    Accelerometer.isAvailableAsync.mockResolvedValue(true);

    await render(<MotionScreen />);

    await waitFor(() => expect(screen.getByTestId('motion-level')).toBeOnTheScreen());
    expect(Accelerometer.addListener).toHaveBeenCalled();
    expect(screen.getByTestId('motion-roll')).toBeOnTheScreen();
  });

  it('keeps the gesture card the E2E flow targets', async () => {
    Accelerometer.isAvailableAsync.mockResolvedValue(false);

    await render(<MotionScreen />);

    expect(screen.getByTestId('motion-gesture-card')).toBeOnTheScreen();
  });
});
