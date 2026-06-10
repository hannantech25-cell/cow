const host     = process.env.INFLUX_HOST     ?? 'localhost';
const port     = process.env.INFLUX_PORT     ?? '8086';
const token    = process.env.INFLUX_TOKEN    ?? '';
const database = process.env.INFLUX_DATABASE ?? 'cow';
const org      = process.env.INFLUX_ORG      ?? 'cow_org';

// Write one or more lines of InfluxDB line protocol via HTTP v2 REST API.
// @influxdata/influxdb3-client targets InfluxDB 3.x (Cloud Dedicated) and
// does not work with InfluxDB 2.x — use the v2 HTTP endpoint directly instead.
export async function writeInfluxLP(lines: string): Promise<void> {
  const url = `http://${host}:${port}/api/v2/write` +
    `?org=${encodeURIComponent(org)}&bucket=${encodeURIComponent(database)}&precision=ns`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Token ${token}`,
      'Content-Type': 'text/plain; charset=utf-8',
    },
    body: lines,
  });
  if (!res.ok) {
    throw new Error(`InfluxDB write failed ${res.status}: ${await res.text()}`);
  }
}
