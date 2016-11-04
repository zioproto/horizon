/**
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may
 * not use this file except in compliance with the License. You may obtain
 * a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS, WITHOUT
 * WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied. See the
 * License for the specific language governing permissions and limitations
 * under the License.
 */

(function() {
  'use strict';

  angular
      .module('horizon.app.core.images')
      .constant('BYTE_TO_GIB', 9.3132e-10)
      .controller('horizon.app.core.images.steps.CreateVolumeController', CreateVolumeController);

  CreateVolumeController.$inject = [
    '$scope',
    '$filter',
    'horizon.app.core.openstack-service-api.cinder',
    'horizon.app.core.openstack-service-api.nova',
    'horizon.framework.widgets.charts.quotaChartDefaults',
    'horizon.app.core.images.validationRules',
    'BYTE_TO_GIB'
  ];

  /**
   * @ngdoc controller
   * @name horizon.app.core.images.steps.CreateVolumeController
   * @param {Object} $scope
   * @param {Object} $filter
   * @param {Object} cinder
   * @param {Object} nova
   * @param {Object} quotaChartDefaults
   * @param {Object} validationRules
   * @description
   * This controller is use for creating an image.
   * @return {undefined} No return value
   */
  function CreateVolumeController(
    $scope,
    $filter,
    cinder,
    nova,
    quotaChartDefaults,
    validationRules,
    BYTE_TO_GIB
   ) {
    var ctrl = this;

    ctrl.volumeType = {};
    ctrl.volumeTypes = [];
    ctrl.availabilityZones = [];
    ctrl.image = $scope.image;
    ctrl.sourceImage = getSourceImage(ctrl.image);
    ctrl.validationRules = validationRules;
    ctrl.maxTotalVolumeGigabytes = 100;
    ctrl.totalGigabytesUsed = 0;
    ctrl.maxTotalVolumes = 1;
    ctrl.totalVolumesUsed = 0;
    ctrl.volumeTypeQuotas = [];

    var numberOfVolumesToAdd = 1;

    // bind for local access and also hand back up to the wizard controller
    // stepModels will be passed to the create volume action submit()
    $scope.stepModels.volumeForm = ctrl.volume = {
      size: Math.ceil(Math.max(ctrl.image.min_disk, ctrl.image.size * BYTE_TO_GIB)) || 1,
      name: ctrl.image.name,
      description: '',
      volume_type: '',
      availability_zone: '',
      metadata: {},
      image_id: ctrl.image.id,
      snapshot_id: null,
      source_volid: null
    };

    ctrl.storageQuota = {
      title: gettext('Volume and Snapshot Quota (GiB)'),
      maxLimit: ctrl.maxTotalVolumeGigabytes,
      label: getPercentUsed(ctrl.volume.size, ctrl.maxTotalVolumeGigabytes),
      data: [
        {
          label: quotaChartDefaults.usageLabel,
          value: ctrl.totalGigabytesUsed,
          colorClass: quotaChartDefaults.usageColorClass
        },
        {
          label: quotaChartDefaults.addedLabel,
          value: ctrl.volume.size,
          colorClass: quotaChartDefaults.addedColorClass
        },
        {
          label: quotaChartDefaults.remainingLabel,
          value: ctrl.maxTotalVolumeGigabytes - ctrl.volume.size,
          colorClass: quotaChartDefaults.remainingColorClass
        }
      ]
    };

    ctrl.volumeQuota = {
      title: gettext('Volume Quota'),
      maxLimit: ctrl.maxTotalVolumes,
      label: getPercentUsed(ctrl.totalVolumesUsed, ctrl.maxTotalVolumes),
      data: [
        {
          label: quotaChartDefaults.usageLabel,
          value: ctrl.totalVolumesUsed,
          colorClass: quotaChartDefaults.usageColorClass
        },
        {
          label: quotaChartDefaults.addedLabel,
          value: numberOfVolumesToAdd,
          colorClass: quotaChartDefaults.addedColorClass
        },
        {
          label: quotaChartDefaults.remainingLabel,
          value: ctrl.maxTotalVolumes - ctrl.totalVolumesUsed,
          colorClass: quotaChartDefaults.remainingColorClass
        }
      ]
    };

    ctrl.volumeTypeCapacityQuota = {
      title: gettext('Volume Type Quota (GB)'),
      maxLimit: 10,
      label: getPercentUsed(ctrl.volume.size, 0),
      data: [
        {
          label: quotaChartDefaults.usageLabel,
          value: 0,
          colorClass: quotaChartDefaults.usageColorClass
        },
        {
          label: quotaChartDefaults.addedLabel,
          value: ctrl.volume.size,
          colorClass: quotaChartDefaults.addedColorClass
        },
        {
          label: quotaChartDefaults.remainingLabel,
          value: 0,
          colorClass: quotaChartDefaults.remainingColorClass
        }
      ]
    };

    ctrl.volumeTypeAmountQuota = {
      title: gettext('Volume Type Quota'),
      maxLimit: 0,
      label: getPercentUsed(0, 0),
      data: [
        {
          label: quotaChartDefaults.usageLabel,
          value: 0,
          colorClass: quotaChartDefaults.usageColorClass
        },
        {
          label: quotaChartDefaults.addedLabel,
          value: numberOfVolumesToAdd,
          colorClass: quotaChartDefaults.addedColorClass
        },
        {
          label: quotaChartDefaults.remainingLabel,
          value: 0,
          colorClass: quotaChartDefaults.remainingColorClass
        }
      ]
    };

    var capacityWatcher = $scope.$watch(
      function() {
        return ctrl.volume.size;
      },
      function() {
        updateVolumeTypeCapacityGraph();
        updateStorageGraph();
      }
    );

    var volumeTypeWatcher = $scope.$watch(
      function() {
        return ctrl.volumeType;
      },
      updateVolumeType,
      true
    );

    // var volumeTypeWatcher = $scope.$watch(
    //   function() {
    //     return ctrl.volume.volume_type;
    //   },
    //   function() {
    //     updateVolumeTypeCapacityGraph();
    //     updateVolumeTypeAmountGraph();
    //   }
    // );

    $scope.volumeTypeWatcher = function(item) {
      updateVolumeTypeCapacityGraph();
      updateVolumeTypeAmountGraph();
    };

    $scope.$on('$destroy', deregisterWatchers);

    init();

    function init() {
      cinder.getVolumeTypes().success(onGetVolumeTypes);
      cinder.getAbsoluteLimits().success(onGetAbsoluteLimits);
      cinder.getAvailabilityZones().success(onGetAvailabilityZones);
    }

    function onGetVolumeTypes(response) {
      ctrl.volumeTypes = response.items;
      cinder.getDefaultVolumeType().success(onGetDefaultVolumeType);
    }

    function onGetDefaultVolumeType(response) {
      ctrl.volumeTypes.forEach(function(volumeType) {
        if (volumeType.name === response.name) {
          ctrl.volumeType = volumeType;
        }
      });
    }

    function onGetAvailabilityZones(response) {
      ctrl.availabilityZones = response.items.map(justNames);
      if (ctrl.availabilityZones.length > 0) {
        ctrl.volume.availability_zone = ctrl.availabilityZones[0];
      }

      function justNames(item) {
        return item.zoneName;
      }
    }

    function onGetAbsoluteLimits(response) {
      ctrl.maxTotalVolumeGigabytes = response.maxTotalVolumeGigabytes;
      ctrl.totalGigabytesUsed = response.totalGigabytesUsed;
      updateStorageGraph();

      ctrl.totalVolumesUsed = response.totalVolumesUsed;
      ctrl.maxTotalVolumes = response.maxTotalVolumes;
      updateInstanceGraph();

      ctrl.volumeTypes.forEach( function (e) {
        ctrl.volumeTypeQuotas[e.name] = {};
        ctrl.volumeTypeQuotas[e.name].used_gigabytes = response["used_gigabytes_"+e.name];
        ctrl.volumeTypeQuotas[e.name].total_gigabytes = response["total_gigabytes_"+e.name];
        ctrl.volumeTypeQuotas[e.name].used_volumes = response["used_volumes_"+e.name];
        ctrl.volumeTypeQuotas[e.name].total_volumes = response["total_volumes_"+e.name];
      } );

      updateVolumeTypeCapacityGraph();
      updateVolumeTypeAmountGraph();
    }

    function updateStorageGraph() {
      if (ctrl.volume.size >= 0) {
        var totalGigabytesAllocated = ctrl.volume.size + ctrl.totalGigabytesUsed;
        ctrl.storageQuota.data[0].value = ctrl.totalGigabytesUsed;
        ctrl.storageQuota.data[1].value = ctrl.volume.size;
        ctrl.storageQuota.data[2].value =
          Math.max(ctrl.maxTotalVolumeGigabytes - totalGigabytesAllocated, 0);
        ctrl.storageQuota.label =
          getPercentUsed(totalGigabytesAllocated,ctrl.maxTotalVolumeGigabytes);
        ctrl.storageQuota.maxLimit = ctrl.maxTotalVolumeGigabytes;
        ctrl.storageQuota.overMax = totalGigabytesAllocated > ctrl.storageQuota.maxLimit;
        ctrl.storageQuota = angular.extend({}, ctrl.storageQuota);
        $scope.volumeForm.$setValidity('volumeSize', !ctrl.storageQuota.overMax);
      }
    }

    function updateInstanceGraph() {
      ctrl.volumeQuota.data[0].value = ctrl.totalVolumesUsed;
      ctrl.volumeQuota.data[2].value =
        Math.max(ctrl.maxTotalVolumes - ctrl.totalVolumesUsed - numberOfVolumesToAdd, 0);
      ctrl.volumeQuota.label = getPercentUsed(ctrl.totalVolumesUsed + numberOfVolumesToAdd,
        ctrl.maxTotalVolumes);
      ctrl.volumeQuota.maxLimit = ctrl.maxTotalVolumes;
      ctrl.volumeQuota.overMax = ctrl.totalVolumesUsed === ctrl.volumeQuota.maxLimit;
      ctrl.volumeQuota = angular.extend({}, ctrl.volumeQuota);
    }

    function updateVolumeTypeCapacityGraph() {
      var type = ctrl.volumeType.name;
      if (type === undefined || ctrl.volumeTypeQuotas[type] === undefined) {}
      else {
        ctrl.volumeTypeAmountQuota.maxLimit = ctrl.volumeTypeQuotas[type].total_gigabytes;
        if (ctrl.volume.size >= 0) {
          var totalGigabytesAllocated = ctrl.volume.size + ctrl.volumeTypeQuotas[type].used_gigabytes;
          ctrl.volumeTypeCapacityQuota.data[0].value = ctrl.volumeTypeQuotas[type].used_gigabytes;
          ctrl.volumeTypeCapacityQuota.data[1].value = ctrl.volume.size;
          ctrl.volumeTypeCapacityQuota.data[2].value =
            Math.max(ctrl.volumeTypeQuotas[type].total_gigabytes - totalGigabytesAllocated, 0);
          ctrl.volumeTypeCapacityQuota.label =
            getPercentUsed(totalGigabytesAllocated, ctrl.volumeTypeQuotas[type].total_gigabytes);
          ctrl.volumeTypeCapacityQuota.maxLimit = ctrl.volumeTypeQuotas[type].total_gigabytes;
          ctrl.volumeTypeCapacityQuota.overMax = totalGigabytesAllocated > ctrl.volumeTypeCapacityQuota.maxLimit;
          ctrl.volumeTypeCapacityQuota = angular.extend({}, ctrl.volumeTypeCapacityQuota);
          $scope.volumeForm.$setValidity('volumeSize', !ctrl.volumeTypeCapacityQuota.overMax);
        }
      }
    }

    function updateVolumeTypeAmountGraph() {
      var type = ctrl.volumeType.name;
      if (type === undefined || ctrl.volumeTypeQuotas[type] === undefined) {}
      else {
        ctrl.volumeTypeAmountQuota.data[0].value = ctrl.volumeTypeQuotas[type].used_volumes;
        ctrl.volumeTypeAmountQuota.data[2].value =
          Math.max(ctrl.volumeTypeQuotas[type].total_volumes - ctrl.volumeTypeQuotas[type].used_volumes - numberOfVolumesToAdd, 0);
        ctrl.volumeTypeAmountQuota.label = getPercentUsed(ctrl.volumeTypeQuotas[type].used_volumes + numberOfVolumesToAdd,
          ctrl.volumeTypeQuotas[type].total_volumes);
        ctrl.volumeTypeAmountQuota.maxLimit = ctrl.volumeTypeQuotas[type].total_volumes;
        ctrl.volumeTypeAmountQuota.overMax = ctrl.volumeTypeQuotas[type].used_volumes === ctrl.volumeTypeAmountQuota.maxLimit;
        ctrl.volumeTypeAmountQuota = angular.extend({}, ctrl.volumeTypeAmountQuota);
      }
    }

    function getPercentUsed(used, total) {
      if (total > 0 && used <= total) {
        return Math.round(used / total * 100) + '%';
      }
      else {
        return '100%';
      }
    }

    function getSourceImage(image) {
      return image.name + ' (' + $filter('bytes')(image.size) + ')';
    }

    function updateVolumeType() {
      ctrl.volume.volume_type = ctrl.volumeType.name || '';
    }

    function deregisterWatchers() {
      capacityWatcher();
      volumeTypeWatcher();
    }
  }
})();
