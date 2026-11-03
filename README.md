# 变静压 VAV · Modbus Slave 协议

Variable-static-pressure VAV Modbus Slave protocol and Node-RED artifacts.

本仓库提供一套**变静压排风**仿真从站：Node-RED 里的 Modbus TCP Slave 按曲线刷新 Holding 寄存器，第三方主站用功能码读写命令字切换「正常 / 值班」。同一流程还提供浏览器曲线页 `/vav`。

This repo is a **variable-static-pressure exhaust** simulator: a Modbus TCP slave inside Node-RED refreshes holding registers along curves, and a third-party master switches **normal / standby** by writing command registers. The same flow serves a browser chart at `/vav`.

## 总线参数 / Bus parameters

| 项 / Item | 值 / Value |
|---|---|
| 协议 / Protocol | Modbus TCP |
| 监听 / Listen | `0.0.0.0:5020`（`modbus-server`） |
| Unit ID | `1` |
| 字节序 / Byte order | Big-endian |
| 寄存器区 / Area | Holding Registers（`4x`） |
| 地址约定 / Addressing | **协议地址从 1 起**；PDU = 协议地址 − 1。Protocol address starts at 1; PDU = protocol address − 1. |

完整点表见仓库根目录 [`vav-modbus-protocol.md`](vav-modbus-protocol.md) 与 [`vav-modbus-protocol.csv`](vav-modbus-protocol.csv)。

## 地址表摘要 / Address map summary

过程量按曲线变化。模式**不会**定时自动切换：默认保持当前模式，直到命令字被写入。

Process values follow curves. The mode stays where it is until a command register is written.

| 协议地址 | PDU | Holding | code | 测点 | 第三方 |
|---:|---:|---:|---|---|---|
| 1–19 | 0–18 | 40001–40019 | `pfyl` `fjpl` `fl` `kd` `wd` `sd` `yc` | 两台排风机、六台排风阀、一套温湿压 | 只读 FC03 |
| 20 | 19 | 40020 | `cmd_normal` | 切正常模式，写 `1` 触发，处理后 Slave 清 `0` | 可写 FC06 / FC16 |
| 21 | 20 | 40021 | `cmd_standby` | 切值班模式，写 `1` 触发，处理后 Slave 清 `0` | 可写 FC06 / FC16 |
| 22 | 21 | 40022 | `mode_status` | 当前模式：`0` 正常 / `1` 值班 | 只读 FC03 |
| 23 | 22 | 40023 | `fl_sum_123` | 排风阀 1+2+3 总风量（m³/h） | 只读 FC03 |
| 24 | 23 | 40024 | `fl_sum_456` | 排风阀 4+5+6 总风量（m³/h） | 只读 FC03 |

20 与 21 同时为 `1` 时，**值班优先**。曲线中心大约为：正常静压 ≈ 500 Pa、频率 ≈ 48 Hz、单阀风量 ≈ 2000 m³/h；值班静压 ≈ 300 Pa、频率 ≈ 28 Hz、单阀风量 ≈ 1000 m³/h。阀开度在约 80% 附近轻摆。

If both 20 and 21 are `1`, **standby wins**. Curve centers are about 500 Pa / 48 Hz / 2000 m³/h per valve in normal mode, and 300 Pa / 28 Hz / 1000 m³/h in standby. Valve position wanders around 80%.

## 文件 / Files

| 文件 | 说明 |
|---|---|
| [`vav-modbus-slave-flow.json`](vav-modbus-slave-flow.json) | 可导入的 Node-RED 流程：Modbus Slave、曲线回写、`/vav` 与 `/vav/api` |
| [`vav-page-template.html`](vav-page-template.html) | `/vav` 使用的 Chart.js 页面模板（已嵌在流程的 template 节点里） |
| [`vav-da-sim-flow.json`](vav-da-sim-flow.json) | 更早的测点模拟流程（`global.vavSim`，无 Modbus Slave），仅作历史参考 |
| [`scripts/vav_patch_assets/`](scripts/vav_patch_assets/) | 补丁素材：`curve_writer.js`、`page.html`、协议副本、`vav_patch_flows.py` |

## 导入 Node-RED / Import the flow

1. 安装 Modbus 节点包 [`node-red-contrib-modbus`](https://flows.nodered.org/node/node-red-contrib-modbus)（流程使用 `modbus-server`、`modbus-client`、`modbus-flex-getter`）。
2. 流程里还有自定义 DA 节点，类型名为 `mtic-da-module-instanse` 与 `mtic-da-module-extend`。调色板里没有这些节点时，导入后它们会显示为未知节点；Modbus 从站、曲线回写和 `/vav` 仍在同一张标签页上。
3. 打开 Node-RED 编辑器 → 菜单 **Import** → 选择 [`vav-modbus-slave-flow.json`](vav-modbus-slave-flow.json) → **Deploy**。
4. 部署后 `modbus-server` 监听 **TCP 5020**（绑定 `0.0.0.0`）。5020 已被占用时，同时改该节点的 `serverPort` 以及客户端节点 `VAV Local Slave` 的 `tcpPort`（流程内客户端指向 `127.0.0.1`）。
5. 标签页上的 Inject「本地调试：正常 / 值班」只用于本机调试，效果与写入命令字 20 / 21 相同。

Install `node-red-contrib-modbus` first. The flow also contains custom DA nodes (`mtic-da-module-instanse`, `mtic-da-module-extend`). If that palette is absent, those nodes show up as unknown after import; the Modbus slave, curve writer, and `/vav` routes are on the same tab. Import `vav-modbus-slave-flow.json` and deploy. The slave listens on **TCP 5020**. The on-canvas injects labeled 本地调试 are local debug shortcuts for the same mode switch.

`scripts/vav_patch_assets/vav_patch_flows.py` 是可选的旧补丁脚本：它按固定节点 id，把曲线函数和页面 HTML 写进一份已经存在的 `flows.json`，并把读寄存器数量改成 24。脚本里的路径（`/home/pi/node-red-da/flows.json`、`/home/pi/vav_patch_assets`）只是当时那台机器上的示例布局。新环境直接导入根目录的 `vav-modbus-slave-flow.json` 即可，该文件已包含 24 点曲线与 `/vav` 页面。

That helper is optional. It patches an existing `flows.json` by node id. The `/home/pi/...` paths inside it are an example layout from one machine. For a new editor, import `vav-modbus-slave-flow.json`.

## 打开曲线页 / Open `/vav`

部署完成后，用浏览器打开 Node-RED 的 HTTP 端口（默认 **1880**，以你的 `settings.js` 为准）：

After deploy, open Node-RED’s HTTP port (default **1880**, or whatever `settings.js` uses):

```text
http://<node-red-host>:1880/vav
http://<node-red-host>:1880/vav/api
```

`/vav` 是 Chart.js 页面，约每秒拉取 `/vav/api`。页面从 jsDelivr 加载 Chart.js，浏览器需要能访问该 CDN。`/vav/api` 返回 JSON：`mode`（`normal` 或 `standby`）、`count`、`points`（环形缓冲，大约保留 20 分钟）。页面展示静压、风机频率、阀 1 风量/开度/模式，以及两组总风量。

`/vav` is a Chart.js page that polls `/vav/api` about once a second. Chart.js is loaded from jsDelivr. `/vav/api` returns `{ mode, count, points }` from a ring buffer of about 20 minutes.

## 第三方如何写 20 / 21 / How a master writes 20 and 21

连到 **运行 Node-RED 的那台主机** 的 TCP **5020**，Unit ID **1**。下面把主机写成 `<host>`，换成实际地址即可。

Connect to TCP **5020** on the host that runs Node-RED, Unit ID **1**. Replace `<host>` below.

| 动作 | 功能码 | 协议地址 | PDU（0 基） | 写入值 | 之后 |
|---|---|---:|---:|---|---|
| 切正常 | FC06 或 FC16 | 20 | 19 | `1` | Slave 清命令字为 `0`；地址 22 变为 `0` |
| 切值班 | FC06 或 FC16 | 21 | 20 | `1` | Slave 清命令字为 `0`；地址 22 变为 `1` |
| 读当前模式 | FC03 | 22 | 21 | — | `0` 正常，`1` 值班 |

过程量 1–19 与汇总 23–24 对第三方是只读（FC03）。命令字是边沿触发：保持写 `1` 没有额外意义，处理完会被清零。

Registers 1–19 and 23–24 are read-only for a third party (FC03). Command registers are edge-triggered: the slave clears them back to `0` after it handles the write.

使用 [mbpoll](https://github.com/epsilonrt/mbpoll) 时，默认参考地址从 1 起，与协议地址一致：

With mbpoll, the default reference is 1-based and matches the protocol address:

```bash
# 读 Holding 1–24
mbpoll -m tcp -a 1 -r 1 -c 24 -t 4 -p 5020 <host>

# 协议地址 20 写 1 → 正常
mbpoll -m tcp -a 1 -r 20 -t 4 -p 5020 <host> 1

# 协议地址 21 写 1 → 值班
mbpoll -m tcp -a 1 -r 21 -t 4 -p 5020 <host> 1

# 读协议地址 22（当前模式）
mbpoll -m tcp -a 1 -r 22 -c 1 -t 4 -p 5020 <host>
```

pymodbus 3.x 使用 **PDU 地址**（协议地址 − 1）。更早版本的参数名可能是 `slave=` 或 `unit=`，而不是 `device_id=`。

pymodbus 3.x takes the **PDU address** (protocol address − 1). Older releases use `slave=` or `unit=` instead of `device_id=`.

```python
from pymodbus.client import ModbusTcpClient

client = ModbusTcpClient("<host>", port=5020)
client.connect()
client.write_register(19, 1, device_id=1)  # protocol 20 → normal
# client.write_register(20, 1, device_id=1)  # protocol 21 → standby
mode = client.read_holding_registers(21, count=1, device_id=1)
print(mode.registers[0])  # 0 normal, 1 standby
client.close()
```
