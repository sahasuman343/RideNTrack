type SignupError = { message: string; code?: string; status?: number };
type SignupPayload = { email: string; password: string; options: { data: { username: string; display_name: string } } };
interface RegistrationClient<T> {
  rpc(name: string, args: { requested_username: string }): PromiseLike<{ data: unknown; error: unknown }>;
  auth: { signUp(payload: SignupPayload): Promise<{ data: T; error: SignupError | null }> };
}

export class UsernameUnavailableError extends Error {
  constructor() {
    super('That username is already taken. Choose another username, or sign in if you already have an account.');
    this.name = 'UsernameUnavailableError';
  }
}

export async function registerAccount<T>(client: RegistrationClient<T>, input: {
  email: string; password: string; username: string; displayName: string;
}): Promise<T> {
  const username = input.username.trim();
  const displayName = input.displayName.trim();
  if (!username || username.length > 64) throw new Error('Choose a username between 1 and 64 characters.');
  if (!displayName) throw new Error('Enter your display name.');

  const available = async () => {
    const { data, error } = await client.rpc('is_username_available', { requested_username: username });
    if (error || typeof data !== 'boolean') throw new Error('Could not check your username. Check your connection and try again.');
    return data;
  };
  if (!await available()) throw new UsernameUnavailableError();

  const { data, error } = await client.auth.signUp({
    email: input.email.trim(), password: input.password,
    options: { data: { username, display_name: displayName } },
  });
  if (error) {
    // The unique constraint remains authoritative if another signup wins the race.
    if (error.code === 'unexpected_failure' || (error.status ?? 0) >= 500) {
      const stillAvailable = await available().catch(() => true);
      if (!stillAvailable) throw new UsernameUnavailableError();
      throw new Error('We could not create your account. Please try again shortly.');
    }
    throw new Error(error.message);
  }
  return data;
}
