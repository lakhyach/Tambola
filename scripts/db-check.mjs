import process from "node:process";
import { Pool } from "pg";

const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.log("no DATABASE_URL in environment");
  process.exit(1);
}
const pool = new Pool({ connectionString: url, max: 2 });
try {
  const res = await pool.query("select current_user, current_database(), version()");
  console.log(JSON.stringify(res.rows));
  console.log("connect=ok");
} catch (error) {
  console.log("connect=FAIL " + error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
