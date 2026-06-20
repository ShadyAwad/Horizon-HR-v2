import { Worker, Job } from 'bullmq';

const REDIS_HOST = process.env.REDIS_HOST || '127.0.0.1';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379', 10);

console.log(`[Worker Engine] Initializing connection to Redis at ${REDIS_HOST}:${REDIS_PORT}...`);

// Initialize the worker to listen to the 'hr-queue'
const hrWorker = new Worker(
  'hr-queue',
  async (job: Job) => {
    console.log(`[Worker Engine] Processing background job: ${job.name} (ID: ${job.id})`);
    
    switch (job.name) {
      case 'processPayroll':
        // Handle heavy payroll or currency conversions
        console.log(`[Payroll] Processing salary data for tenant: ${job.data.tenantId}`);
        break;
        
      case 'sendNotification':
        // Handle sending alert triggers
        console.log(`[Notification] Dispatching alert to employee: ${job.data.employeeId}`);
        break;
        
      default:
        console.log(`[Worker Engine] Unknown job type: ${job.name}`);
    }
  },
  {
    connection: {
      host: REDIS_HOST,
      port: REDIS_PORT,
    },
  }
);

hrWorker.on('completed', (job) => {
  console.log(`[Worker Engine] Job ${job.id} completed successfully.`);
});

hrWorker.on('failed', (job, err) => {
  console.error(`[Worker Engine] Job ${job?.id} failed with error:`, err.message);
});