import * as HTTP from 'http';
import * as HTTPS from 'https';

import { generateUid } from '../../utils/helpers';
import { Options, Listener, HorizontalScaleOptions } from '../../utils/types';
import { WebSocket, WebSocketServer, ConnectionInfo } from '@clusterws/cws';

type SocketExtend = {
    id: string,
    serverId: string
};

export class ScalerServer {
    private wsServer: WebSocketServer;
    private sockets: Array<WebSocket & SocketExtend> = [];

    constructor(private options: Options) {
        const horizontalScaleOptions: HorizontalScaleOptions = this.options.scaleOptions.default.horizontalScaleOptions;
        const server: HTTP.Server | HTTPS.Server = horizontalScaleOptions.masterOptions.tlsOptions ?
            HTTPS.createServer(horizontalScaleOptions.masterOptions.tlsOptions) :
            HTTP.createServer();

        this.wsServer = new WebSocketServer({
            server,
            verifyClient: (info: ConnectionInfo, next: Listener): void => {
                next(info.req.url === `/?key=${horizontalScaleOptions.key || ''}`);
            }
        });

        server.listen(horizontalScaleOptions.masterOptions.port, () => {
            process.send({ event: 'READY', pid: process.pid });
        });

        this.wsServer.on('error', (error: any) => {
            this.options.logger.error(`Scaler error ${error.stack || error}`);
            process.exit();
        });

        this.wsServer.on('connection', (socket: WebSocket & SocketExtend): void => {
            socket.id = generateUid(8);
            this.sockets.push(socket);

            socket.on('message', (message: string | Buffer): void | boolean => {
                // TODO: that is very bad parsing (need to optimize this one)
                if (message[0] !== '{') {
                    socket.serverId = message as string;
                } else if (socket.serverId) {
                    for (let i: number = 0, len: number = this.sockets.length; i < len; i++) {
                        const client: WebSocket & SocketExtend = this.sockets[i];
                        if (client.serverId && socket.serverId !== client.serverId) {
                            client.send(message);
                        }
                    }
                }
            });

            socket.on('close', (code: number, reason: string): void => {
                this.removeSocketById(socket.id);
            });

            socket.on('error', (err: any): void => {
                this.removeSocketById(socket.id);
            });
        });

        this.wsServer.startAutoPing(20000);
    }

    private removeSocketById(socketId: string): any {
        for (let i: number = 0, len: number = this.sockets.length; i < len; i++) {
            if (this.sockets[i].id === socketId) {
                this.sockets.splice(i, 1);
                break;
            }
        }
    }
}
