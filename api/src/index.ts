import 'dotenv/config';
import app from './app';
import { connectMqtt } from './mqtt/client';

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`API server running on http://localhost:${PORT}`);
  connectMqtt();
});
