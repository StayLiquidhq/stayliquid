import {PrivyClient} from '@privy-io/server-auth';

const PRIVY_APP_ID = process.env.PRIVY_APP_ID
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET

if(!PRIVY_APP_ID || !PRIVY_APP_SECRET){
    throw Error('missing environment variables')
}

const privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);

export default privy