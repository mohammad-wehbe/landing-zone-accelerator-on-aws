/**
 *  Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 *  Licensed under the Apache License, Version 2.0 (the "License"). You may not use this file except in compliance
 *  with the License. A copy of the License is located at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  or in the 'license' file accompanying this file. This file is distributed on an 'AS IS' BASIS, WITHOUT WARRANTIES
 *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions
 *  and limitations under the License.
 */

import * as cdk from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { Construct } from 'constructs';
import * as path from 'path';

import { copyPoliciesToDeploymentPackage } from '../common-functions';

/**
 * Remediate resource policy
 * This construct creates a Lambda function which will be triggered by SSM Automation and used to
 * remediate any non-compliant resource policy detected by AWS Config Rule
 */
export interface RemediateResourcePolicyProps {
  /**
   * Prefix for accelerator resources
   */
  readonly acceleratorPrefix: string;
  /**
   * Configuration directory path
   */
  readonly configDirPath: string;
  /**
   * Accelerator home region
   */
  readonly homeRegion: string;
  /**
   * Lambda log group encryption key
   */
  readonly kmsKeyCloudWatch: cdk.aws_kms.IKey;
  /**
   * Lambda environment variable encryption key, when undefined default AWS managed key will be used
   */
  readonly kmsKeyLambda?: cdk.aws_kms.IKey;
  /**
   * Lambda log retention in days
   */
  readonly logRetentionInDays: number;
  /**
   * SCP File Paths
   */
  readonly rbpFilePaths: { name: string; path: string; tempPath: string }[];
  /**
   * Role for remediation lambda
   */
  readonly role: cdk.aws_iam.IRole;
}

export class RemediateResourcePolicy extends Construct {
  lambdaFunction: cdk.aws_lambda.Function;

  constructor(scope: Construct, id: string, props: RemediateResourcePolicyProps) {
    super(scope, id);

    const deploymentPackagePath = path.join(__dirname, 'remediate-resource-policy/dist');
    copyPoliciesToDeploymentPackage(props.rbpFilePaths, deploymentPackagePath);

    const LAMBDA_TIMEOUT_IN_MINUTES = 1;

    this.lambdaFunction = new cdk.aws_lambda.Function(this, 'RemediateResourcePolicyFunction', {
      code: cdk.aws_lambda.Code.fromAsset(path.join(__dirname, 'remediate-resource-policy/dist')),
      runtime: cdk.aws_lambda.Runtime.NODEJS_16_X,
      handler: 'index.handler',
      description: 'Lambda function to remediate non-compliant resource based policy',
      timeout: cdk.Duration.minutes(LAMBDA_TIMEOUT_IN_MINUTES),
      environment: {
        ACCELERATOR_PREFIX: props.acceleratorPrefix,
        AWS_PARTITION: cdk.Aws.PARTITION,
        HOME_REGION: props.homeRegion,
      },
      environmentEncryption: props.kmsKeyLambda,
      role: props.role,
    });

    // AwsSolutions-IAM4: The IAM user, role, or group uses AWS managed policies
    NagSuppressions.addResourceSuppressions(this.lambdaFunction.role!, [
      {
        id: 'AwsSolutions-IAM4',
        reason: 'AWS Custom resource provider framework-role created by cdk.',
      },
    ]);

    // AwsSolutions-IAM5: The IAM entity contains wildcard permissions
    NagSuppressions.addResourceSuppressions(
      this.lambdaFunction.role!,
      [
        {
          id: 'AwsSolutions-IAM5',
          reason: 'Allows only specific policy.',
        },
      ],
      true,
    );

    new cdk.aws_logs.LogGroup(this, `${this.lambdaFunction.node.id}LogGroup`, {
      logGroupName: `/aws/lambda/${this.lambdaFunction.functionName}`,
      retention: props.logRetentionInDays,
      encryptionKey: props.kmsKeyCloudWatch,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
  }
}
