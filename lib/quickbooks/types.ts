export interface QBOAccount {
  Id: string
  Name: string
  AccountType: 'Bank' | 'Credit Card' | string
  AccountSubType: string
  CurrentBalance: number
  CurrencyRef: { value: string; name: string }
  Active: boolean
  Classification: 'Asset' | 'Liability' | string
}

export interface QBOAccountsResponse {
  QueryResponse: {
    Account: QBOAccount[]
    startPosition: number
    maxResults: number
  }
  time: string
}

export interface QBOTokenResponse {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
  x_refresh_token_expires_in: number
}

export interface AccountBalance {
  id: string
  name: string
  type: 'bank' | 'credit_card'
  subType: string
  balance: number
  currency: string
}

export interface QBOTransactionRow {
  date: string
  txnType: string
  docNum: string
  name: string
  memo: string
  account: string
  split: string
  amount: number
}

export interface QBOTransactionListResponse {
  Header: {
    ReportName: string
    DateMacro: string
    StartPeriod: string
    EndPeriod: string
    Currency: string
  }
  Columns: { Column: Array<{ ColTitle: string; ColType: string }> }
  Rows: {
    Row?: Array<{
      ColData?: Array<{ value: string }>
      type?: string
    }>
  }
}
