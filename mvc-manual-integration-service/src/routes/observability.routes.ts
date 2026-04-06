import { NextFunction, Request, Response, Router } from 'express';
import {
  adapters,
  createChildLogger,
  express as observabilityExpress,
  getLogger,
  incrementCounter,
  recordException,
  recordHistogram,
  setGauge,
  startSpan,
  type AppLogger
} from '@my-org/observability-node-ts';

const router = Router();
const DEMO_COMPONENT = 'mvc-package-demo';

type RequestWithLogger = Request & {
  log?: AppLogger;
};

type FakePinoCall = {
  level: string;
  args: unknown[];
};

type FakeWinstonInfo = Record<string, unknown>;

type FakeWinstonTransport = {
  log(info: FakeWinstonInfo, callback?: () => void): void;
};

type FakeWinstonLogger = {
  transports: FakeWinstonTransport[];
  add(transport: FakeWinstonTransport): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
};

function getRequestLogger(req: Request) {
  return (req as RequestWithLogger).log || getLogger();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeChunk(
  stream: {
    write(chunk: string | Buffer, callback: (error?: Error | null) => void): void;
  },
  chunk: string | Buffer
) {
  return new Promise<void>((resolve, reject) => {
    stream.write(chunk, (error?: Error | null) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function createFakePinoLogger() {
  const calls: FakePinoCall[] = [];
  const createLevelHandler = (level: string) => (...args: unknown[]) => {
    calls.push({ level, args });
  };

  return {
    calls,
    debug: createLevelHandler('debug'),
    info: createLevelHandler('info'),
    warn: createLevelHandler('warn'),
    error: createLevelHandler('error'),
    fatal: createLevelHandler('fatal')
  };
}

function createFakeWinstonLogger(): FakeWinstonLogger {
  const transports: FakeWinstonTransport[] = [];

  function emit(level: string, message: string, fields?: Record<string, unknown>) {
    const info = {
      level,
      message,
      ...(fields || {})
    };

    transports.forEach((transport) => {
      transport.log(info, () => undefined);
    });
  }

  return {
    transports,
    add(transport: FakeWinstonTransport) {
      transports.push(transport);
    },
    info(message: string, fields?: Record<string, unknown>) {
      emit('info', message, fields);
    },
    warn(message: string, fields?: Record<string, unknown>) {
      emit('warn', message, fields);
    },
    error(message: string, fields?: Record<string, unknown>) {
      emit('error', message, fields);
    }
  };
}

router.get('/logger-tools', (req: Request, res: Response) => {
  const baseLogger = getLogger();
  const childLogger = createChildLogger({
    component: DEMO_COMPONENT,
    feature: 'logger-tools'
  });

  baseLogger.info('mvc package base logger route', {
    route: '/package/logger-tools'
  });
  childLogger.info('mvc package child logger route', {
    route: '/package/logger-tools'
  });
  getRequestLogger(req).info('mvc package request logger route', {
    route: '/package/logger-tools'
  });

  res.json({
    ok: true,
    usedExports: ['getLogger', 'createChildLogger']
  });
});

router.get('/span-metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const logger = createChildLogger({
      component: DEMO_COMPONENT,
      feature: 'span-metrics'
    });
    const manualSpan = startSpan('mvc.package.manual-span');
    manualSpan.setAttribute('mvc.package.route', '/package/span-metrics');
    manualSpan.end();

    const callbackResult = await startSpan('mvc.package.callback-span', {}, async (activeSpan) => {
      activeSpan.setAttribute('mvc.package.route', '/package/span-metrics');
      incrementCounter('mvc_package_demo_counter_total', 1, {
        route: '/package/span-metrics'
      });
      recordHistogram('mvc_package_demo_duration_ms', 42, {
        route: '/package/span-metrics'
      });
      setGauge('mvc_package_demo_last_value', 42, {
        route: '/package/span-metrics'
      });
      logger.info('mvc package span metrics route', {
        route: '/package/span-metrics'
      });
      await sleep(25);
      return 42;
    });

    res.json({
      ok: true,
      callbackResult,
      manualSpanEnded: true,
      usedExports: ['startSpan', 'incrementCounter', 'recordHistogram', 'setGauge']
    });
  } catch (error) {
    next(error);
  }
});

router.get('/record-exception', (req: Request, res: Response) => {
  const cause = new Error('Recorded exception root cause');
  const error = new Error('Manual package route exception') as Error & {
    cause?: Error;
    code?: string;
    statusCode?: number;
  };

  error.cause = cause;
  error.code = 'PACKAGE_RECORDED_EXCEPTION';
  error.statusCode = 499;

  recordException(error, {
    route: '/package/record-exception'
  });
  getRequestLogger(req).warn('mvc manual exception recorded', {
    route: '/package/record-exception',
    error
  });

  res.status(202).json({
    ok: true,
    code: error.code,
    usedExports: ['recordException']
  });
});

router.get('/pino-stream', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const stream = adapters.pino.createPinoStreamAdapter({
      component: DEMO_COMPONENT,
      route: '/package/pino-stream'
    });

    await writeChunk(stream, Buffer.from(JSON.stringify({
      level: 50,
      route: '/package/pino-stream',
      err: {
        message: 'mvc fake pino stream error',
        code: 'MVC_PINO_STREAM'
      }
    })));

    res.json({
      ok: true,
      forwarded: true,
      usedExports: ['adapters.pino.createPinoStreamAdapter']
    });
  } catch (error) {
    next(error);
  }
});

router.get('/pino-instrument', (req: Request, res: Response) => {
  const fakePinoLogger = createFakePinoLogger();
  const instrumented = adapters.pino.instrumentPinoLogger(fakePinoLogger as any, {
    component: DEMO_COMPONENT,
    route: '/package/pino-instrument'
  });
  const second = adapters.pino.instrumentPinoLogger(fakePinoLogger as any, {
    component: DEMO_COMPONENT,
    route: '/package/pino-instrument'
  });
  const error = new Error('mvc fake pino instrument error') as Error & {
    code?: string;
  };

  error.code = 'MVC_PINO_INSTRUMENT';
  instrumented.error(error);
  getRequestLogger(req).info('mvc fake pino instrument route completed', {
    route: '/package/pino-instrument'
  });

  res.json({
    ok: true,
    originalLogCalls: fakePinoLogger.calls.length,
    sameLogger: instrumented === second,
    usedExports: ['adapters.pino.instrumentPinoLogger']
  });
});

router.get('/winston-transport', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const transport = adapters.winston.createWinstonTransport({
      component: DEMO_COMPONENT,
      route: '/package/winston-transport'
    });

    await new Promise<void>((resolve) => {
      (transport as any).log({
        level: 'warn',
        message: 'mvc fake winston transport log',
        route: '/package/winston-transport'
      }, resolve);
    });

    res.json({
      ok: true,
      forwarded: true,
      usedExports: ['adapters.winston.createWinstonTransport']
    });
  } catch (error) {
    next(error);
  }
});

router.get('/winston-instrument', (req: Request, res: Response) => {
  const fakeWinstonLogger = createFakeWinstonLogger();
  const first = adapters.winston.instrumentWinstonLogger(fakeWinstonLogger as any, {
    component: DEMO_COMPONENT,
    route: '/package/winston-instrument'
  });
  const second = adapters.winston.instrumentWinstonLogger(fakeWinstonLogger as any, {
    component: DEMO_COMPONENT,
    route: '/package/winston-instrument'
  });

  fakeWinstonLogger.warn('mvc fake winston instrument log', {
    route: '/package/winston-instrument'
  });
  getRequestLogger(req).info('mvc fake winston instrument route completed', {
    route: '/package/winston-instrument'
  });

  res.json({
    ok: true,
    addedTransportCount: fakeWinstonLogger.transports.length,
    reusedTransport: first.transport === second.transport,
    usedExports: ['adapters.winston.instrumentWinstonLogger']
  });
});

router.get('/express-error', (_req: Request, _res: Response, next: NextFunction) => {
  const error = new Error('Package express error middleware demo') as Error & {
    code?: string;
    expose?: boolean;
    statusCode?: number;
  };

  error.code = 'PACKAGE_EXPRESS_ERROR';
  error.expose = true;
  error.statusCode = 418;
  next(error);
});

router.use(observabilityExpress.errorMiddleware);

export { router as observabilityRoutes };
