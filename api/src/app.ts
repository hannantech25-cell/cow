import express from 'express';
import cors from 'cors';
import authRouter      from './routes/auth';
import usersRouter     from './routes/users';
import cowsRouter      from './routes/cows';
import trackersRouter  from './routes/trackers';
import geofencesRouter from './routes/geofences';
import alertsRouter    from './routes/alerts';
import farmsRouter     from './routes/farms';
import realtimeRouter  from './routes/realtime';
import gatewayRouter   from './routes/gateway';
import { errorHandler } from './middleware/errorHandler';

const app = express();

const corsOrigin = process.env.CORS_ORIGIN;
app.use(cors({
  origin: corsOrigin ? corsOrigin.split(',').map(o => o.trim()) : true,
}));
app.use(express.json());

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth',      authRouter);
app.use('/api/users',     usersRouter);
app.use('/api/cows',      cowsRouter);
app.use('/api/trackers',  trackersRouter);
app.use('/api/geofences', geofencesRouter);
app.use('/api/alerts',    alertsRouter);
app.use('/api/farms',     farmsRouter);
app.use('/api/realtime',  realtimeRouter);
app.use('/api/gateway',   gatewayRouter);

app.use(errorHandler);

export default app;
