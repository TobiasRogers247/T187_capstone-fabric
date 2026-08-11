# Local Windows Setup

This guide sets up a local Hyperledger Fabric development environment on Windows for this repository.

## Current machine status

Checked on August 11, 2026:

- `WSL` is not installed on this machine yet
- `docker` is not installed on this machine yet

## Official references

- Hyperledger Fabric prerequisites: https://hyperledger-fabric.readthedocs.io/en/latest/prereqs.html
- Hyperledger Fabric install guide: https://hyperledger-fabric.readthedocs.io/en/latest/install.html
- Hyperledger Fabric test network: https://hyperledger-fabric.readthedocs.io/en/latest/test_network.html
- Docker Desktop WSL 2 backend: https://docs.docker.com/desktop/features/wsl/
- Docker Desktop WSL best practices: https://docs.docker.com/desktop/features/wsl/best-practices/

## Important note

Do Fabric development inside the Linux filesystem in WSL, not inside the Windows path under `C:\`.

That means this Windows repo is your host copy, but your active Fabric runtime copy should be cloned again inside Ubuntu, for example under:

```text
~/code/T187_capstone-fabric
```

## Step 1: Install WSL2 and Ubuntu

Open **PowerShell as Administrator** and run:

```powershell
wsl --install -d Ubuntu-22.04
wsl --update
wsl --set-default-version 2
```

Then restart Windows if prompted.

After restart, verify:

```powershell
wsl --status
wsl -l -v
```

Expected result:

- Ubuntu is installed
- Ubuntu is using WSL version `2`

## Step 2: Install Docker Desktop

Download and install Docker Desktop for Windows from the official Docker installer:

- https://www.docker.com/products/docker-desktop/

After install:

1. Start Docker Desktop
2. Open `Settings`
3. Confirm `Use WSL 2 based engine` is enabled
4. Open `Resources > WSL Integration`
5. Enable integration for your Ubuntu distribution
6. Make sure Docker is using **Linux containers**

Then verify from PowerShell:

```powershell
docker version
docker compose version
```

## Step 3: Open Ubuntu and install Linux-side prerequisites

Open Ubuntu and run:

```bash
sudo apt-get update
sudo apt-get install -y git curl jq build-essential
```

Verify:

```bash
git --version
curl --version
jq --version
docker version
docker compose version
```

## Step 4: Clone this Fabric repo inside WSL

Inside Ubuntu:

```bash
mkdir -p ~/code
cd ~/code
git clone https://github.com/TobiasRogers247/T187_capstone-fabric.git
cd T187_capstone-fabric
```

## Step 5: Install Fabric samples, Docker images, and binaries

Inside Ubuntu:

```bash
mkdir -p ~/hyperledger
cd ~/hyperledger
curl -sSLO https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh
chmod +x install-fabric.sh
./install-fabric.sh -h
./install-fabric.sh docker samples binary
```

This installs:

- `fabric-samples`
- Fabric Docker images
- Fabric CLI binaries such as `peer`, `orderer`, `configtxgen`, `fabric-ca-client`, and `fabric-ca-server`

## Step 6: Prove the local Fabric dev network works

Inside Ubuntu:

```bash
cd ~/hyperledger/fabric-samples/test-network
./network.sh down
./network.sh up createChannel -c energychannel -ca
docker ps
```

If the network starts correctly, you should have:

- an orderer
- peer containers
- CA containers
- a channel named `energychannel`

When finished:

```bash
./network.sh down
```

## Step 7: What comes next

After the test network is working, the next work is:

1. Decide the actual Fabric structure for this project
2. Create your own network files under `network/`
3. Create your own chaincode under `chaincode/energy-market/`
4. Add enrollment and startup scripts under `network/scripts/`
5. Later clone the same repo onto the remote Ubuntu VM and repeat the runtime generation there

