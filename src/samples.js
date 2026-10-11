// 演示数据：虚构主体与金额。clean 可直接分摊；dirty 故意埋了几类常见错误，用于演示报错自助修正。
window.SAMPLES = {
  headcount: `entity,cost_center,headcount
US01,CC-US-HR,18
US01,CC-US-FIN,12
US01,CC-US-IT,25
CA01,CC-CA-HR,6
CA01,CC-CA-OPS,14
SG01,CC-SG-HR,9
SG01,CC-SG-FIN,7
SG01,CC-SG-SALES,11`,

  clean: `invoice_id,entity,country,cost_type,amount,currency
INV-2409-001,US01,US,Benefits Platform,12500.00,USD
INV-2409-002,US01,US,Payroll Service,8420.55,USD
INV-2409-003,US01,US,Training,3100.00,USD
INV-2409-004,CA01,CA,Benefits Platform,4800.00,CAD
INV-2409-005,CA01,CA,Payroll Service,2210.40,CAD
INV-2409-006,SG01,SG,Medical Check Up,6390.00,SGD
INV-2409-007,SG01,SG,Payroll Service,2875.25,SGD
INV-2409-008,SG01,SG,Training,1000.00,SGD`,

  dirty: `invoice_id,entity,country,cost_type,amount,currency
INV-2409-101,US01,US,Benefits Platform,12500.00,USD
INV-2409-102,,US,Payroll Service,8420.55,USD
INV-2409-103,US02,US,Training,3100.00,USD
INV-2409-104,CA01,CA,Benefits Platform,4800.00,USD
INV-2409-105,CA01,CA,Payroll Service,-210.40,CAD
INV-2409-106,SG01,SG,Medical Check Up,"6,390.00",SGD
INV-2409-106,SG01,SG,Medical Check Up,6390.00,SGD`,
};
