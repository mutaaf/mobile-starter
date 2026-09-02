import OrbitScreen from '@/app/index';
import { ApiError } from '@/lib/api';

import { render, screen, waitFor } from '../test-utils';

jest.mock('@/lib/api', () => ({
  ...jest.requireActual('@/lib/api'),
  fetchIss: jest.fn(),
}));

// Lottie renders through a native view that has no Jest implementation.
jest.mock('lottie-react-native', () => 'LottieView');

const { fetchIss } = jest.requireMock('@/lib/api');

const POSITION = {
  latitude: -45.4168,
  longitude: -162.4163,
  altitude: 437.85,
  velocity: 27530.4,
  visibility: 'daylight',
  footprint: 4597.2,
  timestamp: 1788301106,
};

afterEach(() => {
  jest.clearAllMocks();
});

describe('OrbitScreen', () => {
  it('renders live telemetry once the downlink resolves', async () => {
    fetchIss.mockResolvedValue(POSITION);

    await render(<OrbitScreen />);

    await waitFor(() => expect(screen.getByTestId('orbit-latitude')).toBeOnTheScreen());
    // Southern/western hemispheres must render as positive magnitudes with a
    // compass suffix, not as negative numbers.
    expect(screen.getByText('45.417° S')).toBeOnTheScreen();
    expect(screen.getByText('162.416° W')).toBeOnTheScreen();
    expect(screen.getByText('27,530')).toBeOnTheScreen();
    expect(screen.getByTestId('orbit-plot')).toBeOnTheScreen();
  });

  it('shows a recoverable error state rather than an empty panel', async () => {
    fetchIss.mockRejectedValue(new ApiError('Network unreachable'));

    await render(<OrbitScreen />);

    await waitFor(() => expect(screen.getByTestId('orbit-error')).toBeOnTheScreen());
    expect(screen.getByText(/Pull to retry/)).toBeOnTheScreen();
    expect(screen.queryByTestId('orbit-plot')).not.toBeOnTheScreen();
  });
});
