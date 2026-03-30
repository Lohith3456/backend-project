import 'dotenv/config';
import { AppDataSource } from './config/data-source';
import app from './app';

const PORT = process.env.PORT || 4000;

AppDataSource.initialize()
  .then(() => {
    console.log('Database connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('DB connection failed:', err);
    process.exit(1);
  });
