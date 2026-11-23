import { migrate } from './migrate';
import { pool } from './pool';

migrate()
  .then(() => console.log('[db] migrations up to date'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
