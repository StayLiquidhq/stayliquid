export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { initGeoIp } = await import("@/lib/geoip");
  await initGeoIp();
}
