const RETRY_DELAYS_MS = [150, 300, 600] as const;

export async function retryAuthProfile<T>(
  readProfile: () => Promise<T | undefined>,
  isReady: (profile: T | undefined) => boolean,
  wait: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds))
): Promise<T | undefined> {
  let profile = await readProfile();

  for (const delay of RETRY_DELAYS_MS) {
    if (isReady(profile)) return profile;
    await wait(delay);
    profile = await readProfile();
  }

  return profile;
}
