import os
from dataclasses import dataclass

@dataclass
class WorkerConfig:
    host: str = os.getenv('WORKER_HOST')
    port: int = int(os.getenv('WORKER_PORT'))
    prefix: str = "/api/v0"

    url: str = None

    def __post_init__(self):
        if not self.url: self.url=f'http://{self.host}:{self.port}'


@dataclass
class GatewayConfig:
    host: str = os.getenv('GATEWAY_HOST')
    port: int = int(os.getenv('GATEWAY_PORT'))

    url: str = None

    def __post_init__(self):
        if not self.url: self.url=f'http://{self.host}:{self.port}'

@dataclass
class Config:

    debug: str = os.getenv('DEBUG')
    log_level: str = os.getenv('LOG_LEVEL')
    this_host: str = os.getenv('THIS_HOST')
    this_port: int = int(os.getenv('THIS_PORT'))

    secret_key: str = os.getenv('SECRET_KEY')

    gateway: "GatewayConfig" = None
    worker: "WorkerConfig" = None

    def __post_init__(self):
        if not self.gateway: self.gateway = GatewayConfig()
        if not self.worker: self.worker = WorkerConfig()


config = Config()


