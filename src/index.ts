import { config } from 'dotenv';
import { Client } from 'twitter-api-sdk';
import { Telegraf } from 'telegraf';
import { Logger } from 'tslog';
import { setTimeout } from 'timers/promises';
import cliProgress from 'cli-progress';

config();

// Twitter API credentials from environment variables
const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN as string;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN as string;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID as string;
const USERS_TO_MONITOR = process.env.USERS_TO_MONITOR as string;




if (!TWITTER_BEARER_TOKEN || !TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID || !USERS_TO_MONITOR) {
    throw new Error("Environment variables are not properly set.");
}

// Initialize logging
const logger = new Logger({ name: "BotLogger" });

function logWithEmoji(message: string, emoji: string) {
    logger.info(`${emoji} ${message}`);
}

// Initialize Twitter API v2 client
let client: Client;
try {
    client = new Client(TWITTER_BEARER_TOKEN);
    logWithEmoji("Connected to Twitter API", "🐦");
} catch (e) {
    logger.error(`Error connecting to Twitter API: ${e}`);
}

// Initialize Telegram Bot
let bot: Telegraf;
try {
    bot = new Telegraf(TELEGRAM_BOT_TOKEN);
    logWithEmoji("Connected to Telegram Bot", "🤖");
} catch (e) {
    logger.error(`Error connecting to Telegram Bot: ${e}`);
}

// Send a test message to Telegram
async function sendTestMessage() {
    try {
        await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, "Bot started and connected successfully!");
        logWithEmoji("Test message sent to Telegram", "✅");
    } catch (e) {
        logger.error(`Error sending test message: ${e}`);
    }
}

async function sendTelegramMessage(message: string) {
    try {
        await bot.telegram.sendMessage(TELEGRAM_CHAT_ID, message);
        logWithEmoji("Message sent to Telegram", "📩");
    } catch (e) {
        logger.error(`Error sending message: ${e}`);
    }
}

async function checkTweets(userIds: string[], lastTweetIds: { [key: string]: string | null }, startTime: string) {
    for (const userId of userIds) {
        try {
            const response = await client.tweets.usersIdTweets(userId, {
                since_id: lastTweetIds[userId] || undefined,
                max_results: 5,
                'tweet.fields': ['id', 'text', 'author_id', 'created_at'],
                expansions: ['author_id'],
                start_time: startTime
            });
            let newTweetsFound = false;
            if (response.data && response.data.length > 0) {
                for (const tweet of response.data.reverse()) {
                    const message = `New tweet posted by user ID ${userId}:\n\n${tweet.text}`;
                    await sendTelegramMessage(message);
                    lastTweetIds[userId] = tweet.id;
                    newTweetsFound = true;
                }
            }
            if (newTweetsFound) {
                logWithEmoji(`New tweets found and processed for user ID ${userId}`, "✅");
            } else {
                logWithEmoji(`No new tweets found for user ID ${userId}`, "❌");
            }
            logWithEmoji(`Fetched tweets for user ID ${userId}`, "🔄");
        } catch (e) {
            if ((e as any).code === 429) {
                logWithEmoji("Rate limit exceeded. Waiting before retrying...", "⏳");
                await setTimeout(900000); // Wait for 15 minutes
            } else {
                logger.error(`Error fetching tweets for user ID ${userId}: ${e}`);
                if (e instanceof Error) {
                    logger.error(`Error message: ${e.message}`);
                    logger.error(`Error stack: ${e.stack}`);
                    // Log additional error details if available
                    const errorResponse = (e as any).response;
                    if (errorResponse) {
                        logger.error(`Error response data: ${JSON.stringify(errorResponse.data)}`);
                        logger.error(`Error response status: ${errorResponse.status}`);
                        logger.error(`Error response headers: ${JSON.stringify(errorResponse.headers)}`);
                    } else {
                        logger.error(`Full error object: ${JSON.stringify(e)}`);
                    }
                }
            }
        }
    }
    return lastTweetIds;
}

async function main() {
    // Get user IDs to monitor
    const userIds: string[] = [];
    const usernames = USERS_TO_MONITOR.split(',');
    for (const username of usernames) {
        try {
            const user = await client.users.findUserByUsername(username.trim(), { 'user.fields': ['id'] });
            if (!user.data) {
                throw new Error(`User not found: ${username}`);
            }
            userIds.push(user.data.id);
            logWithEmoji(`Fetched user ID for ${username}`, "🆔");
        } catch (e) {
            logger.error(`Error fetching user ID for ${username}: ${e}`);
            if (e instanceof Error) {
                logger.error(`Error message: ${e.message}`);
                logger.error(`Error stack: ${e.stack}`);
                // Log additional error details if available
                const errorResponse = (e as any).response;
                if (errorResponse) {
                    logger.error(`Error response data: ${JSON.stringify(errorResponse.data)}`);
                    logger.error(`Error response status: ${errorResponse.status}`);
                    logger.error(`Error response headers: ${JSON.stringify(errorResponse.headers)}`);
                } else {
                    logger.error(`Full error object: ${JSON.stringify(e)}`);
                }
            }
            return;
        }
    }

    // Initialize lastTweetIds with the latest tweet IDs
    const lastTweetIds: { [key: string]: string | null } = {};
    const startTime = new Date().toISOString();
    for (const userId of userIds) {
        try {
            const lastTweetResponse = await client.tweets.usersIdTweets(userId, { max_results: 5 });
            if (lastTweetResponse.data && lastTweetResponse.data.length > 0) {
                lastTweetIds[userId] = lastTweetResponse.data[0].id;
                logWithEmoji(`Initialized last tweet ID for user ID ${userId}`, "🔍");
            } else {
                lastTweetIds[userId] = null;
                logWithEmoji(`No initial tweet found for user ID ${userId}`, "⚠️");
            }
        } catch (e) {
            logger.error(`Error fetching initial tweets for user ID ${userId}: ${e}`);
            if (e instanceof Error) {
                logger.error(`Error message: ${e.message}`);
                logger.error(`Error stack: ${e.stack}`);
                // Log additional error details if available
                const errorResponse = (e as any).response;
                if (errorResponse) {
                    logger.error(`Error response data: ${JSON.stringify(errorResponse.data)}`);
                    logger.error(`Error response status: ${errorResponse.status}`);
                    logger.error(`Error response headers: ${JSON.stringify(errorResponse.headers)}`);
                } else {
                    logger.error(`Full error object: ${JSON.stringify(e)}`);
                }
            }
        }
    }

    // Send a test message when the script starts
    await sendTestMessage();

    while (true) {
        await checkTweets(userIds, lastTweetIds, startTime);
        logWithEmoji("Waiting for next fetch cycle", "⏳");

        // Initialize the progress bar
        const progressBar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        progressBar.start(100, 0);

        // Simulate the waiting period with progress bar update
        const sleepDuration = 120000; // 100 seconds
        const updateInterval = sleepDuration / 100; // update every 1% of the duration

        for (let i = 0; i <= 100; i++) {
            await setTimeout(updateInterval);
            progressBar.update(i);
        }

        progressBar.stop();
    }
}

main().catch(e => logger.error(e));
