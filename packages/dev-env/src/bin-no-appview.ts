import './env'
import { TestNetworkNoAppView } from './network-no-appview'

const run = async () => {
  console.log(`
██████╗
██╔═══██╗
██║██╗██║
██║██║██║
╚█║████╔╝
 ╚╝╚═══╝  protocol

[ created by Bluesky ]`)

  const config = {
      pds: {
          port: 2583,
          hostname: 'localhost',
          enableDidDocWithSession: true,
          dataDirectory: process.env.PDS_DATA_DIRECTORY,
      },
      plc: { port: 2582 },
  };
  // If the data directory is not set, make sure the default is used.
  if (!config.pds.dataDirectory) {
    delete config.pds.dataDirectory;
  }
  const network = await TestNetworkNoAppView.create(config);

  console.log(`👤 DID Placeholder server http://localhost:${network.plc.port}`)
  console.log(`🌞 Main PDS http://localhost:${network.pds.port}`)
  console.log(`🌞 Main PDS account DB`, network.pds.ctx.cfg.db.accountDbLoc)
  console.log(
    `🔨 Lexicon authority DID ${network.pds.ctx.cfg.lexicon.didAuthority}`,
  )
  for (const fg of network.feedGens) {
    console.log(`🤖 Feed Generator (${fg.did}) http://localhost:${fg.port}`)
  }

  console.log('✅ Dev environment is ready')
}

run()
